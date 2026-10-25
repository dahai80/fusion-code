import { describe, expect, it } from "bun:test";
import {
    CORE_TOOLS,
    FULL_TOOLS,
    getMlxToolFilterForModel,
    MEDIUM_TOOLS,
    parseModelSizeB,
} from "../../utils/mlxToolTiers.js";

// #222: 数值分档回归表 — 旧子串匹配把 "14b" 判进 "1b" 档 (14b 含 1b 子串)。
// 覆盖真实 registry 风格 model id (HF snapshot 名 + 常见命名变体)。
describe("#222 mlx tool tier — numeric size parse", () => {
    describe("parseModelSizeB", () => {
        it("parses plain sizes", () => {
            expect(parseModelSizeB("qwen3-1b")).toBe(1);
            expect(parseModelSizeB("llama-14b")).toBe(14);
            expect(parseModelSizeB("qwen3-32b")).toBe(32);
        });

        it("parses decimal sizes", () => {
            expect(parseModelSizeB("qwen3-0.6b")).toBe(0.6);
            expect(parseModelSizeB("model-0.5b-instruct")).toBe(0.5);
        });

        it("case-insensitive", () => {
            expect(parseModelSizeB("Qwen2.5-14B-Instruct")).toBe(14);
            expect(parseModelSizeB("Llama-3.2-1B")).toBe(1);
        });

        it("does not match quantization suffix (4bit has no word boundary)", () => {
            // "4b" inside "4bit" must NOT count — \b fails before "it"
            expect(parseModelSizeB("qwen3-4bit")).toBeNull();
            expect(parseModelSizeB("qwen3.5-4b-MLX-4bit")).toBe(4);
        });

        it("returns null for unparseable ids", () => {
            expect(parseModelSizeB("claude-sonnet-5")).toBeNull();
            expect(parseModelSizeB("gpt-4o")).toBeNull();
            expect(parseModelSizeB("")).toBeNull();
        });
    });

    describe("getMlxToolFilterForModel tier assignment", () => {
        const cases: Array<[string, Set<string>, string]> = [
            // [modelId, expected tier, label]
            ["Qwen--Qwen3-0.6B", CORE_TOOLS, "0.6B → CORE (≤2B)"],
            ["llama-3.2-1b-instruct", CORE_TOOLS, "1B → CORE"],
            ["qwen2.5-2b", CORE_TOOLS, "2B boundary → CORE"],
            ["qwen3-4b-instruct-mlx", MEDIUM_TOOLS, "4B → MEDIUM"],
            ["deepseek-8b-block7", MEDIUM_TOOLS, "8B → MEDIUM"],
            ["qwen3-9b", MEDIUM_TOOLS, "9B boundary → MEDIUM"],
            ["Qwen2.5-14B-Instruct", FULL_TOOLS, "14B → FULL (was CORE: substring bug)"],
            ["Qwen3.8-27B-DFlash2", FULL_TOOLS, "27B → FULL"],
            ["qwen2.5-32b", FULL_TOOLS, "32B → FULL"],
        ];

        for (const [modelId, expectedTier, label] of cases) {
            it(label, () => {
                expect(getMlxToolFilterForModel(modelId)).toBe(expectedTier);
            });
        }

        it("14b model does NOT land in ≤2B CORE tier (the #222 bug)", () => {
            const filter = getMlxToolFilterForModel("qwen2.5-14b");
            expect(filter).toBe(FULL_TOOLS);
            expect(filter).not.toBe(CORE_TOOLS);
            // FULL 包含 CORE 没有的高级工具 (Agent 等)
            expect(filter.has("Agent")).toBe(true);
        });

        it("unparseable model id → FULL toolset (legacy behavior)", () => {
            expect(getMlxToolFilterForModel("some-cloud-model")).toBe(FULL_TOOLS);
            expect(getMlxToolFilterForModel("")).toBe(FULL_TOOLS);
        });

        it("tier nesting: CORE ⊂ MEDIUM ⊂ FULL", () => {
            for (const t of CORE_TOOLS) expect(MEDIUM_TOOLS.has(t)).toBe(true);
            for (const t of MEDIUM_TOOLS) expect(FULL_TOOLS.has(t)).toBe(true);
        });
    });
});
