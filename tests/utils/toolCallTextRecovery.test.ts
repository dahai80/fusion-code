import { describe, expect, test } from "bun:test";
import { detectToolCallShapedText } from "src/utils/queryHelpers.js";

const TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

describe("detectToolCallShapedText", () => {
	test("detects python-call style with a known tool name", () => {
		const text = 'Read({file_path: "/tmp/config.ini"})';
		expect(detectToolCallShapedText(text, TOOLS)).toBe(true);
	});

	test("detects multiline python-call style", () => {
		const text =
			'Let me look.\nWrite({\n  "file_path": "/tmp/a.py",\n  "content": "x"\n})';
		expect(detectToolCallShapedText(text, TOOLS)).toBe(true);
	});

	test("detects call_<id>{...} engine-prefixed shape", () => {
		expect(
			detectToolCallShapedText('call_8bf1498f{"file_path": "a.py"}', TOOLS),
		).toBe(true);
	});

	test("detects <tools>{...} wrapper shape", () => {
		expect(
			detectToolCallShapedText('<tools>{"name": "Read"}</tools>', TOOLS),
		).toBe(true);
	});

	test("ignores unknown tool-shaped names (ordinary prose)", () => {
		const text = "The function Main({x}) in the template is illustrative.";
		expect(detectToolCallShapedText(text, TOOLS)).toBe(false);
	});

	test("ignores plain prose and lowercase calls", () => {
		expect(detectToolCallShapedText("I will read the file now.", TOOLS)).toBe(
			false,
		);
		expect(
			detectToolCallShapedText("main({x: 1}) is the entry point.", TOOLS),
		).toBe(false);
	});

	test("ignores empty text", () => {
		expect(detectToolCallShapedText("", TOOLS)).toBe(false);
	});
});
