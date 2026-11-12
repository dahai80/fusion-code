import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    FULL_TOOLS,
    MEDIUM_TOOLS,
    CORE_TOOLS,
    getMlxToolFilterForModel,
    parseModelSizeB,
} from "../../utils/mlxToolTiers";

// Tier-spec v1.0.0 conformance suite (evolution plan P3.2). Pins the runtime
// mlxToolTiers behavior to the published table in docs/tier-spec/ — the
// spec, the schema, the JSON instance, and the runtime cannot drift apart.

const DOCS = join(import.meta.dir, "..", "..", "..", "docs", "tier-spec");
const table = JSON.parse(readFileSync(join(DOCS, "tiers.json"), "utf8")) as {
    specVersion: string;
    tiers: Array<{ name: string; maxParamsB: number | null; tools: string[] }>;
};
const schema = JSON.parse(
    readFileSync(join(DOCS, "tiers.schema.json"), "utf8"),
) as Record<string, unknown>;

// Minimal JSON-Schema validator for the subset the tier schema uses
// (no new runtime dependency — the schema is deliberately small).
function validate(value: unknown, sch: Record<string, any>): string[] {
    const errors: string[] = [];
    const types = Array.isArray(sch.type) ? sch.type : [sch.type];
    const actual = Array.isArray(value)
        ? "array"
        : value === null
          ? "null"
          : typeof value;
    if (sch.type && !types.includes(actual)) {
        errors.push(`type: expected ${types.join("|")}, got ${actual}`);
        return errors;
    }
    if (typeof value === "string") {
        if (sch.minLength !== undefined && value.length < sch.minLength)
            errors.push(`minLength: ${value.length} < ${sch.minLength}`);
        if (sch.pattern && !new RegExp(sch.pattern).test(value))
            errors.push(`pattern: ${value} !~ ${sch.pattern}`);
    }
    if (typeof value === "number" && sch.exclusiveMinimum !== undefined) {
        if (value <= sch.exclusiveMinimum)
            errors.push(`exclusiveMinimum: ${value} <= ${sch.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
        if (sch.minItems !== undefined && value.length < sch.minItems)
            errors.push(`minItems: ${value.length} < ${sch.minItems}`);
        if (sch.uniqueItems && new Set(value).size !== value.length)
            errors.push("uniqueItems violated");
        if (sch.items) {
            value.forEach((item, i) => {
                errors.push(
                    ...validate(item, sch.items as Record<string, any>).map(
                        (e) => `[${i}].${e}`,
                    ),
                );
            });
        }
    }
    if (actual === "object" && sch.type === "object") {
        for (const key of sch.required ?? []) {
            if (!(key in (value as object)))
                errors.push(`required: missing ${key}`);
        }
        for (const [key, sub] of Object.entries(sch.properties ?? {})) {
            if (key in (value as object)) {
                errors.push(
                    ...validate(
                        (value as Record<string, unknown>)[key],
                        sub as Record<string, any>,
                    ).map((e) => `${key}.${e}`),
                );
            }
        }
        if (sch.additionalProperties === false) {
            for (const key of Object.keys(value as object)) {
                if (!(key in (sch.properties ?? {})))
                    errors.push(`additionalProperties: unexpected ${key}`);
            }
        }
    }
    return errors;
}

describe("tier-spec v1.0.0 conformance (P3.2)", () => {
    test("published tier table passes the JSON schema", () => {
        expect(validate(table, schema)).toEqual([]);
    });

    test("schema rejects a malformed table (bounds, chain fields)", () => {
        const bad = {
            specVersion: "1.0.0",
            tiers: [{ name: "core", maxParamsB: -1, tools: ["Read"] }],
        };
        expect(validate(bad, schema).length).toBeGreaterThan(0);
        const noTools = {
            specVersion: "1.0.0",
            tiers: [{ name: "core", maxParamsB: 2 }],
        };
        expect(validate(noTools, schema).length).toBeGreaterThan(0);
    });

    test("tool sets form a superset chain (core ⊆ medium ⊆ full)", () => {
        for (const tool of CORE_TOOLS) {
            expect(MEDIUM_TOOLS.has(tool)).toBe(true);
        }
        for (const tool of MEDIUM_TOOLS) {
            expect(FULL_TOOLS.has(tool)).toBe(true);
        }
    });

    test("table structure: exactly one unbounded tier, bounds ascending", () => {
        const nulls = table.tiers.filter((t) => t.maxParamsB === null);
        expect(nulls).toHaveLength(1);
        const bounds = table.tiers
            .map((t) => t.maxParamsB)
            .filter((b): b is number => b !== null);
        for (let i = 1; i < bounds.length; i++) {
            expect(bounds[i]!).toBeGreaterThan(bounds[i - 1]!);
        }
    });

    test("runtime tier sets match the published table exactly", () => {
        const runtimeSets: Record<string, Set<string>> = {
            core: CORE_TOOLS,
            medium: MEDIUM_TOOLS,
            full: FULL_TOOLS,
        };
        for (const tier of table.tiers) {
            const runtime = runtimeSets[tier.name];
            expect(runtime).toBeDefined();
            expect([...runtime].sort()).toEqual([...tier.tools].sort());
        }
    });

    test("size parsing follows §1 (numeric, decimal, word boundary)", () => {
        expect(parseModelSizeB("qwen2.5-coder-3b-instruct")).toBe(3);
        expect(parseModelSizeB("llama-0.6b")).toBe(0.6);
        expect(parseModelSizeB("qwen2.5-coder-32b-instruct")).toBe(32);
        // #222 regression: "14b" must not substring-match "1b".
        expect(parseModelSizeB("qwen2.5-14b-instruct")).toBe(14);
        // "4bit" has no word boundary after "4b".
        expect(parseModelSizeB("foo-4bit")).toBe(null);
        expect(parseModelSizeB("glm-4.5-air")).toBe(null);
    });

    test("tier selection follows §2 (boundaries + unknown → full)", () => {
        const names = (s: Set<string>) => [...s].sort().join(",");
        const tableBySize = (sizeB: number | null): string => {
            let chosen = table.tiers.find((t) => t.maxParamsB === null)!;
            if (sizeB !== null) {
                for (const t of table.tiers) {
                    if (t.maxParamsB !== null && sizeB <= t.maxParamsB) {
                        chosen = t;
                        break;
                    }
                }
            }
            return [...chosen.tools].sort().join(",");
        };
        for (const id of [
            "llama-0.6b",
            "q-2b",
            "q-2.1b",
            "q-9b",
            "q-9.1b",
            "q-14b",
            "q-32b",
            "glm-4.5-air",
            "foo-4bit",
        ]) {
            const runtime = names(getMlxToolFilterForModel(id));
            const size = parseModelSizeB(id);
            expect(`${id}: ${runtime}`).toBe(`${id}: ${tableBySize(size)}`);
        }
        // Spot-check the boundary semantics directly.
        expect(getMlxToolFilterForModel("q-2b")).toBe(CORE_TOOLS);
        expect(getMlxToolFilterForModel("q-2.1b")).toBe(MEDIUM_TOOLS);
        expect(getMlxToolFilterForModel("q-9b")).toBe(MEDIUM_TOOLS);
        expect(getMlxToolFilterForModel("q-9.1b")).toBe(FULL_TOOLS);
        expect(getMlxToolFilterForModel("glm-4.5-air")).toBe(FULL_TOOLS);
    });
});
