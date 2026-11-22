import { describe, expect, test } from "bun:test";
import {
	editsAfterLastTest,
	VERIFY_BEFORE_REPORT_MARKER,
} from "../../utils/queryHelpers.js";

function assistantToolUse(name: string, input: Record<string, unknown> = {}) {
	return {
		type: "assistant" as const,
		message: { content: [{ type: "tool_use" as const, name, input }] },
	};
}

describe("editsAfterLastTest", () => {
	test("true when an edit happens with no test command at all", () => {
		const msgs = [assistantToolUse("Read"), assistantToolUse("Edit", {})];
		expect(editsAfterLastTest(msgs)).toBe(true);
	});

	test("false when tests ran after the last edit", () => {
		const msgs = [
			assistantToolUse("Edit"),
			assistantToolUse("Bash", { command: "python3 -m pytest -q" }),
		];
		expect(editsAfterLastTest(msgs)).toBe(false);
	});

	test("true when tests ran before the last edit", () => {
		const msgs = [
			assistantToolUse("Bash", { command: "bun test" }),
			assistantToolUse("Edit"),
		];
		expect(editsAfterLastTest(msgs)).toBe(true);
	});

	test("recognizes common test/build commands", () => {
		for (const cmd of [
			"python3 -m pytest tests/",
			"bun run check",
			"npm test",
			"cargo test",
			"go build ./...",
			"tsc --noEmit",
			"make test",
		]) {
			expect(
				editsAfterLastTest([
					assistantToolUse("Edit"),
					assistantToolUse("Bash", { command: cmd }),
				]),
			).toBe(false);
		}
	});

	test("ignores non-verify bash commands", () => {
		const msgs = [
			assistantToolUse("Edit"),
			assistantToolUse("Bash", { command: "ls -la" }),
		];
		expect(editsAfterLastTest(msgs)).toBe(true);
	});

	test("string-content messages are skipped safely", () => {
		expect(
			editsAfterLastTest([
				{ type: "user", message: { content: "plain string" } },
				assistantToolUse("Write"),
			]),
		).toBe(true);
		expect(editsAfterLastTest([])).toBe(false);
	});

	test("marker constant is stable", () => {
		expect(VERIFY_BEFORE_REPORT_MARKER).toBe("[verify-before-report]");
	});
});
