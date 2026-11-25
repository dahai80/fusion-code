import { describe, expect, test } from "bun:test";
import { formatCompactSummary } from "src/services/compact/prompt.js";

describe("formatCompactSummary", () => {
    test("strips a closed analysis block and formats the summary", () => {
        const out = formatCompactSummary(
            "<analysis>draft thoughts</analysis><summary>Did the work</summary>",
        );
        expect(out).toBe("Summary:\nDid the work");
    });

    test("strips an unterminated analysis block before the summary", () => {
        const out = formatCompactSummary(
            "<analysis>runaway drafting with no closing tag\n<summary>Kept text</summary>",
        );
        expect(out).toBe("Summary:\nKept text");
        expect(out).not.toContain("runaway");
    });

    test("strips an unterminated analysis block with no summary section", () => {
        const out = formatCompactSummary("<analysis>only scratchpad, never closed");
        expect(out).toBe("");
    });

    test("formats an unterminated summary block without leaking the tag", () => {
        const out = formatCompactSummary("<summary>Content that never closes");
        expect(out).toBe("Summary:\nContent that never closes");
        expect(out).not.toContain("<summary>");
    });

    test("leaves a summary without analysis tags unchanged apart from formatting", () => {
        const out = formatCompactSummary("plain continuation text");
        expect(out).toBe("plain continuation text");
    });
});
