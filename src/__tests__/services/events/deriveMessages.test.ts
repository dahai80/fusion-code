// ar-plan PR #8 (S2.2): deriveMessages 投影测。
import { describe, expect, it } from "bun:test";
import { deriveMessages } from "../../../services/events/deriveMessages.js";
import type { SessionEventLog } from "../../../services/events/SessionEvent.js";
import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "../../../types/message.js";
import { createUserMessage } from "../../../utils/messages.js";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const UUID_C = "00000000-0000-4000-8000-000000000003";

function makeUser(uuid: string, text: string): UserMessage {
	return createUserMessage({
		content: text,
		uuid,
		timestamp: "2026-01-01T00:00:00.000Z",
	});
}

function makeAssistant(uuid: string): AssistantMessage {
	return {
		type: "assistant",
		uuid: uuid as AssistantMessage["uuid"],
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			id: uuid,
			role: "assistant",
			model: "test-model",
			content: [{ type: "text", text: "ans" }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as AssistantMessage["message"],
	};
}

describe("deriveMessages", () => {
	it("empty log → empty Message[]", () => {
		expect(deriveMessages([])).toEqual([]);
	});

	it("user_message single → [Message]", () => {
		const u = makeUser(UUID_A, "hi");
		const log: SessionEventLog = [{ seq: 1, type: "user_message", data: u }];
		expect(deriveMessages(log)).toEqual([u]);
	});

	it("user_message spread array → flattened", () => {
		const a = makeUser(UUID_A, "a");
		const b = makeUser(UUID_B, "b");
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: [a, b] },
		];
		expect(deriveMessages(log)).toEqual([a, b]);
	});

	it("assistant_message + tool_result → ordered", () => {
		const u = makeUser(UUID_A, "q");
		const a = makeAssistant(UUID_C);
		const tr = makeUser(UUID_B, "result");
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: u },
			{ seq: 2, type: "assistant_message", data: a },
			{ seq: 3, type: "tool_result", data: tr },
		];
		expect(deriveMessages(log)).toEqual([u, a, tr]);
	});

	it("compact boundary → truncates prior messages", () => {
		const u = makeUser(UUID_A, "old");
		const a = makeAssistant(UUID_C);
		const post = makeUser(UUID_B, "after-compact");
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: u },
			{ seq: 2, type: "assistant_message", data: a },
			{ seq: 3, type: "compact", data: { reason: "threshold" } },
			{ seq: 4, type: "user_message", data: post },
		];
		expect(deriveMessages(log)).toEqual([post]);
	});

	it("turn_start/turn_end/error skipped", () => {
		const u = makeUser(UUID_A, "q");
		const log: SessionEventLog = [
			{ seq: 1, type: "turn_start", data: {} },
			{ seq: 2, type: "user_message", data: u },
			{ seq: 3, type: "turn_end", data: {} },
			{ seq: 4, type: "error", data: "oops" },
		];
		expect(deriveMessages(log)).toEqual([u]);
	});

	it("seq out-of-order input → ordered output", () => {
		const a = makeUser(UUID_A, "a");
		const b = makeAssistant(UUID_C);
		const c = makeUser(UUID_B, "c");
		const log: SessionEventLog = [
			{ seq: 3, type: "tool_result", data: c },
			{ seq: 1, type: "user_message", data: a },
			{ seq: 2, type: "assistant_message", data: b },
		];
		const out: Message[] = deriveMessages(log);
		expect(out.map((m) => m.uuid)).toEqual([UUID_A, UUID_C, UUID_B]);
	});
});
