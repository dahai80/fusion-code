import { describe, expect, test } from "bun:test";
import { createFinalTurnNudgeMessage } from "src/utils/messages.js";

describe("createFinalTurnNudgeMessage", () => {
	test("creates a meta user message with verify-now instruction", () => {
		const msg = createFinalTurnNudgeMessage();
		expect(msg.type).toBe("user");
		expect(msg.isMeta).toBe(true);
		const blocks = msg.message.content;
		const text = Array.isArray(blocks) && blocks[0]?.type === "text" ? blocks[0].text : "";
		expect(text).toContain("final turn");
		expect(text).toContain("verification");
	});

	test("returns a fresh uuid per call", () => {
		const a = createFinalTurnNudgeMessage();
		const b = createFinalTurnNudgeMessage();
		expect(a.uuid).not.toBe(b.uuid);
	});
});
