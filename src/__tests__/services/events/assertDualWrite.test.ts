// ar-plan PR #8 (S2.2): assertDualWrite dev 断言测。
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { assertDualWrite } from "../../../services/events/deriveMessages.js";
import type { SessionEventLog } from "../../../services/events/SessionEvent.js";
import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "../../../types/message.js";
import { createUserMessage } from "../../../utils/messages.js";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const UUID_C = "00000000-0000-4000-8000-000000000009";

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

describe("assertDualWrite", () => {
	let savedNodeEnv: string | undefined;
	let savedEs: string | undefined;

	beforeEach(() => {
		savedNodeEnv = process.env.NODE_ENV;
		savedEs = process.env.FUSION_CODE_EVENT_SOURCING;
	});
	afterEach(() => {
		if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = savedNodeEnv;
		if (savedEs === undefined) delete process.env.FUSION_CODE_EVENT_SOURCING;
		else process.env.FUSION_CODE_EVENT_SOURCING = savedEs;
	});

	it("prod (non-dev) + env on → no-op, no throw on drift", () => {
		delete process.env.NODE_ENV; // 非 development
		process.env.FUSION_CODE_EVENT_SOURCING = "1";
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: makeUser(UUID_A, "a") },
		];
		const mutable: Message[] = [makeUser(UUID_C, "DIFFERENT")]; // drift
		expect(() => assertDualWrite(log, mutable, "t1")).not.toThrow();
	});

	it("dev + env off → no-op, no throw on drift", () => {
		process.env.NODE_ENV = "development";
		delete process.env.FUSION_CODE_EVENT_SOURCING;
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: makeUser(UUID_A, "a") },
		];
		const mutable: Message[] = [makeUser(UUID_C, "DIFFERENT")];
		expect(() => assertDualWrite(log, mutable, "t2")).not.toThrow();
	});

	it("dev + env on + match → no throw", () => {
		process.env.NODE_ENV = "development";
		process.env.FUSION_CODE_EVENT_SOURCING = "1";
		const u = makeUser(UUID_A, "a");
		const log: SessionEventLog = [{ seq: 1, type: "user_message", data: u }];
		const mutable: Message[] = [u];
		expect(() => assertDualWrite(log, mutable, "t3")).not.toThrow();
	});

	it("dev + env on + drift → throws (fail-visible)", () => {
		process.env.NODE_ENV = "development";
		process.env.FUSION_CODE_EVENT_SOURCING = "1";
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: makeUser(UUID_A, "a") },
		];
		const mutable: Message[] = [makeUser(UUID_A, "b")]; // drift (同 uuid 不同 content)
		expect(() => assertDualWrite(log, mutable, "t4")).toThrow(
			/dual-write drift at turn t4/,
		);
	});

	it("dev + env on + missing push-point (mutable longer) → throws", () => {
		process.env.NODE_ENV = "development";
		process.env.FUSION_CODE_EVENT_SOURCING = "1";
		const log: SessionEventLog = [
			{ seq: 1, type: "user_message", data: makeUser(UUID_A, "a") },
		];
		const mutable: Message[] = [
			makeUser(UUID_A, "a"),
			makeAssistant(UUID_B), // 旁路漏写 assistant_message
		];
		expect(() => assertDualWrite(log, mutable, "t5")).toThrow(/drift/);
	});

	it("dev + env on + empty both → no throw (boundary)", () => {
		process.env.NODE_ENV = "development";
		process.env.FUSION_CODE_EVENT_SOURCING = "1";
		expect(() => assertDualWrite([], [], "t6")).not.toThrow();
	});
});
