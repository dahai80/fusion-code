import { describe, expect, mock, test } from "bun:test";

// Force OSC 8 support on for the render path under test (stdout is a pipe
// in bun test, so supports-hyperlinks would otherwise report false).
mock.module("../../src/ink/supports-hyperlinks.js", () => ({
	supportsHyperlinks: () => true,
	ADDITIONAL_HYPERLINK_TERMINALS: [],
}));

// Sever the settings.ts TDZ cycle: markdown.ts's import graph reaches
// components/MarkdownTable.tsx, which reads settings at module scope.
mock.module("../../src/components/design-system/color.js", () => ({
	color: () => (text: string) => text,
}));

const { applyMarkdown } = await import("../../src/utils/markdown");

describe("applyMarkdown file path linkification", () => {
	test("linkifies absolute file paths with extensions in plain text", () => {
		const out = applyMarkdown(
			"delivered at /Users/dahai/fusion/code-research/docs/report.pptx done",
			{},
		);
		expect(out).toContain(
			"file:///Users/dahai/fusion/code-research/docs/report.pptx",
		);
	});

	test("linkifies home-relative paths", () => {
		const out = applyMarkdown("see ~/fusion/notes/plan.md for details", {});
		expect(out).toContain("file://~/fusion/notes/plan.md");
	});

	test("does not linkify extension-less directory paths", () => {
		const out = applyMarkdown("output lands in /tmp/build dir", {});
		expect(out).not.toContain("file://");
	});

	test("does not linkify URLs", () => {
		const out = applyMarkdown(
			"docs at https://example.com/a/b/guide.md and http://x.io/r/readme.tex",
			{},
		);
		expect(out).not.toContain("file://https");
		expect(out).not.toContain("file:///a/b");
	});

	test("does not linkify bare version-like tokens", () => {
		const out = applyMarkdown("released v0.8.33 today", {});
		expect(out).not.toContain("file://");
	});
});
