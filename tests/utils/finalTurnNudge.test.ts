import { describe, expect, test } from "bun:test";
import { createFinalTurnNudgeMessage } from "src/utils/messages.js";

describe("createFinalTurnNudgeMessage", () => {
	test("creates a meta user message with verify-now instruction", () => {
		const msg = createFinalTurnNudgeMessage();
		expect(msg.type).toBe("user");
		expect(msg.isMeta).toBe(true);
		const blocks = msg.message.content;
		const text =
			Array.isArray(blocks) && blocks[0]?.type === "text" ? blocks[0].text : "";
		expect(text).toContain("final turn");
		expect(text).toContain("verification");
	});

	test("returns a fresh uuid per call", () => {
		const a = createFinalTurnNudgeMessage();
		const b = createFinalTurnNudgeMessage();
		expect(a.uuid).not.toBe(b.uuid);
	});
});

describe("lastTestCommandFailed", () => {
	const { lastTestCommandFailed } = require("src/utils/queryHelpers.js");

	function msgs(seq: Array<Record<string, unknown>>) {
		return seq.map((b) => ({ message: { content: [b] } }));
	}

	test("false when no test command ran", () => {
		const seq = msgs([
			{ type: "tool_use", id: "u1", name: "Bash", input: { command: "ls" } },
			{ type: "tool_result", tool_use_id: "u1", content: "Exit code 1\nboom" },
		]);
		expect(lastTestCommandFailed(seq)).toBe(false);
	});

	test("true when last test command exited nonzero", () => {
		const seq = msgs([
			{ type: "tool_use", id: "u1", name: "Bash", input: { command: "pytest" } },
			{ type: "tool_result", tool_use_id: "u1", content: "Exit code 1\nfailed" },
			{ type: "tool_use", id: "u2", name: "Read", input: { file_path: "a.py" } },
			{ type: "tool_result", tool_use_id: "u2", content: "ok" },
		]);
		expect(lastTestCommandFailed(seq)).toBe(true);
	});

	test("false when last test command succeeded", () => {
		const seq = msgs([
			{ type: "tool_use", id: "u1", name: "Bash", input: { command: "pytest" } },
			{ type: "tool_result", tool_use_id: "u1", content: "Exit code 0\nall passed" },
		]);
		expect(lastTestCommandFailed(seq)).toBe(false);
	});

	test("false when result is unprefixed success output", () => {
		const seq = msgs([
			{ type: "tool_use", id: "u1", name: "Bash", input: { command: "cargo test" } },
			{ type: "tool_result", tool_use_id: "u1", content: "test result: ok" },
		]);
		expect(lastTestCommandFailed(seq)).toBe(false);
	});

	test("handles array-content tool results", () => {
		const seq = msgs([
			{ type: "tool_use", id: "u1", name: "Bash", input: { command: "bun test" } },
			{
				type: "tool_result",
				tool_use_id: "u1",
				content: [{ type: "text", text: "Exit code 2\ncollection error" }],
			},
		]);
		expect(lastTestCommandFailed(seq)).toBe(true);
	});
});
