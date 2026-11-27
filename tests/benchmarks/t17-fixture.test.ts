import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "../../benchmarks/harness-gain/verify.js";
import { readFileSync } from "node:fs";

// T17 fixture regression: the test file asserted "- b" / "+ c" (sign +
// space), a format no standard tool produces, while the prompt asked for
// "unified-diff-style" output. A correct difflib.unified_diff solution
// failed the tests, causing every T17 failure. The canonical stdlib
// solution must resolve against the fixture, and the empty fixture must
// fail — both through verify() itself.
const suite = JSON.parse(
    readFileSync(
        join(import.meta.dir, "..", "..", "benchmarks/harness-gain/tasks.json"),
        "utf8",
    ),
);
const t17 = suite.tasks.find((t: any) => t.id === "T17");

const SOLUTION =
    "import difflib\n\ndef diff_lines(a, b):\n    return [\n        line\n        for line in difflib.unified_diff(a, b, lineterm=\"\")\n        if not line.startswith((\"---\", \"+++\", \"@@\"))\n    ]\n";

const cleanups: string[] = [];

afterEach(() => {
    for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
    cleanups.length = 0;
});

describe("T17 fixture", () => {
    test("fixture embeds the corrected test file", () => {
        expect(t17.verify.test).toBe("tests/test_difftool.py");
        const fixture = extractFixtureTests();
        expect(fixture).toContain("'-b' in l");
        expect(fixture).toContain("'+c' in l");
        expect(fixture).not.toContain("'- b' in l");
    });

    test("canonical difflib solution resolves through verify()", () => {
        const dir = mkdtempSync(join(tmpdir(), "t17-fixture-"));
        cleanups.push(dir);
        writeFileSync(join(dir, "difftool.py"), SOLUTION);
        mkdirSync(join(dir, "tests"), { recursive: true });
        writeFileSync(join(dir, "tests/test_difftool.py"), extractFixtureTests());
        const r = verify(t17.verify, dir);
        expect(r.resolved).toBe(true);
    });

    test("empty fixture fails through verify()", () => {
        const dir = mkdtempSync(join(tmpdir(), "t17-fixture-"));
        cleanups.push(dir);
        writeFileSync(join(dir, "difftool.py"), "");
        mkdirSync(join(dir, "tests"), { recursive: true });
        writeFileSync(join(dir, "tests/test_difftool.py"), extractFixtureTests());
        expect(verify(t17.verify, dir).resolved).toBe(false);
    });
});

function extractFixtureTests(): string {
    // Pull the embedded tests/test_difftool.py literal straight out of
    // run.ts FIXTURES so the guard tracks the real fixture, not a copy.
    const src = readFileSync(
        join(import.meta.dir, "..", "..", "benchmarks/harness-gain/run.ts"),
        "utf8",
    );
    const m = src.match(/T17: \(\) => \(\{[\s\S]*?"tests\/test_difftool\.py":\s*\n\s*"((?:[^"\\]|\\.)*)"/);
    if (!m) throw new Error("T17 fixture not found in run.ts");
    return JSON.parse(`"${m[1]}"`);
}
