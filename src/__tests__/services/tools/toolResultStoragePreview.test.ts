import { describe, expect, it } from "bun:test";
import {
	buildLargeToolResultMessage,
	generatePreview,
	PERSISTED_OUTPUT_CLOSING_TAG,
	PERSISTED_OUTPUT_TAG,
	PREVIEW_SIZE_BYTES,
} from "../../../utils/toolResultStorage.js";

// P1.1 Spill — tail preview unit tests.
// generatePreview was head-only; now emits head + tail when content exceeds
// the budget, and stays byte-identical to the old behavior when it fits.

describe("generatePreview — tail preview (P1.1)", () => {
	it("returns full content with no tail when content fits budget", () => {
		const content = "line1\nline2\nline3\n";
		const result = generatePreview(content, 100);
		expect(result.preview).toBe(content);
		expect(result.hasMore).toBe(false);
		expect(result.tailPreview).toBeUndefined();
	});

	it("emits head + tail when content exceeds budget", () => {
		// 10 lines, 12 chars each (incl \n) = 120 chars, budget 50.
		const lines = Array.from({ length: 10 }, (_, i) => `line${i}AAAAAA`);
		const content = `${lines.join("\n")}\n`;
		const result = generatePreview(content, 50);
		expect(result.hasMore).toBe(true);
		expect(result.tailPreview).toBeDefined();
		const tail = result.tailPreview as string;
		expect(tail.length).toBeGreaterThan(0);
		// head is a prefix of content, tail is a suffix
		expect(content.startsWith(result.preview)).toBe(true);
		expect(content.endsWith(tail)).toBe(true);
	});

	it("head and tail do not overlap (a gap exists between them)", () => {
		// 50 chars/line × 50 lines = 2550 > PREVIEW_SIZE_BYTES (2000) → truncates.
		const lines = Array.from({ length: 50 }, (_, i) =>
			`row${i}`.padEnd(50, "x"),
		);
		const content = `${lines.join("\n")}\n`;
		const result = generatePreview(content, PREVIEW_SIZE_BYTES);
		expect(result.hasMore).toBe(true);
		expect(result.tailPreview).toBeDefined();
		const tail = result.tailPreview as string;
		const headEnd = content.indexOf(result.preview) + result.preview.length;
		const tailStart = content.lastIndexOf(tail);
		expect(tailStart).toBeGreaterThan(headEnd);
	});

	it("tail starts on a line boundary (no half-leading-line)", () => {
		// 8 chars/line; budget 60 → head 36 / tail 24. Tail window straddles a
		// newline near its start (newline at offset 5 < 12), so trim lands on a
		// full line token — tail begins with "L", not mid-line padding "z".
		const lines = Array.from({ length: 20 }, (_, i) => `L${i}`.padEnd(8, "z"));
		const content = `${lines.join("\n")}\n`;
		const result = generatePreview(content, 60);
		expect(result.tailPreview).toBeDefined();
		const tail = result.tailPreview as string;
		// Tail should start with "L" (a line start), not "z" (mid-line padding)
		expect(tail.startsWith("L")).toBe(true);
	});

	it("head + tail bytes stay within the budget", () => {
		const content = "a".repeat(5000);
		const budget = 2000;
		const result = generatePreview(content, budget);
		expect(result.hasMore).toBe(true);
		expect(result.tailPreview).toBeDefined();
		const tail = result.tailPreview as string;
		const total = result.preview.length + tail.length;
		expect(total).toBeLessThanOrEqual(budget);
	});

	it("falls back to exact-byte cut when no newlines (single long line)", () => {
		const content = "X".repeat(500);
		const result = generatePreview(content, 100);
		expect(result.hasMore).toBe(true);
		expect(result.tailPreview).toBeDefined();
		// No newlines: head = first 60 bytes, tail = last 40 bytes
		expect(result.preview).toBe(content.slice(0, 60));
		expect(result.tailPreview).toBe(content.slice(460));
	});
});

describe("buildLargeToolResultMessage — tail branch (P1.1)", () => {
	const baseResult = {
		filepath: "/tmp/tool-results/abc123.txt",
		originalSize: 5000,
		isJson: false,
	};

	it("includes both head and tail previews when tailPreview is set", () => {
		const message = buildLargeToolResultMessage({
			...baseResult,
			preview: "HEAD-CONTENT",
			hasMore: true,
			tailPreview: "TAIL-CONTENT",
		});
		expect(message).toContain(PERSISTED_OUTPUT_TAG);
		expect(message).toContain(PERSISTED_OUTPUT_CLOSING_TAG);
		expect(message).toContain("HEAD-CONTENT");
		expect(message).toContain("TAIL-CONTENT");
		expect(message).toContain("output truncated, see file for full content");
		expect(message).toContain("Preview (first");
		expect(message).toContain("Preview (last");
	});

	it("stays byte-identical to old behavior when tailPreview is undefined", () => {
		// Old behavior: hasMore true → '\n...\n' suffix, no tail section.
		const message = buildLargeToolResultMessage({
			...baseResult,
			preview: "HEAD-ONLY",
			hasMore: true,
		});
		expect(message).toContain("HEAD-ONLY");
		expect(message).not.toContain("Preview (last");
		expect(message).not.toContain(
			"output truncated, see file for full content",
		);
		expect(message).toContain("\n...\n");
	});

	it("hasMore false and no tail → trailing newline only", () => {
		const message = buildLargeToolResultMessage({
			...baseResult,
			preview: "SHORT",
			hasMore: false,
		});
		expect(message).toContain("SHORT");
		expect(message).not.toContain("Preview (last");
		expect(message).not.toContain("\n...\n");
		expect(message.endsWith(PERSISTED_OUTPUT_CLOSING_TAG)).toBe(true);
	});
});
