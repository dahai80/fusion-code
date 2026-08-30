import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message } from "../types/message.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_MODEL } from "../utils/messages.js";
import {
	getTokenCountFromUsage,
	sumAssistantMessageTokens,
} from "../utils/tokens.js";

// audit 1.4.5: finalizeAgentTool totalTokens now uses sumAssistantMessageTokens
// (sum of ALL non-synthetic assistant turns), replacing the last-turn-only
// estimate that undercounted multi-loop agents and defeated the subagent budget
// brake. Tests the pure helper directly (cycle-safe import from tokens.ts).

function makeAssistant(usage: {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}): AssistantMessage {
	return {
		type: "assistant",
		uuid: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		message: {
			id: "msg_test",
			type: "message",
			role: "assistant",
			model: "real-model",
			content: [{ type: "text", text: "ok" }],
			stop_reason: "end_turn",
			usage,
		},
	} as unknown as AssistantMessage;
}

describe("audit 1.4.5 — sumAssistantMessageTokens full-loop sum", () => {
	test("single assistant turn → that turn's token count", () => {
		expect(
			sumAssistantMessageTokens([
				makeAssistant({ input_tokens: 100, output_tokens: 50 }),
			]),
		).toBe(150);
	});

	test("multi-turn loop → sum of ALL turns (not last-turn-only)", () => {
		// 5 tool-loop turns each 100 input + 50 output = 750. Old last-turn-only
		// reported 150 — a 5x undercount that defeated the budget brake.
		const msgs: Message[] = [];
		for (let i = 0; i < 5; i++) {
			msgs.push(makeAssistant({ input_tokens: 100, output_tokens: 50 }));
		}
		expect(sumAssistantMessageTokens(msgs)).toBe(750);
	});

	test("cache tokens included per turn", () => {
		// turn1 = 100+50+30+200 = 380; turn2 = 80+20 = 100; total 480
		expect(
			sumAssistantMessageTokens([
				makeAssistant({
					input_tokens: 100,
					output_tokens: 50,
					cache_creation_input_tokens: 30,
					cache_read_input_tokens: 200,
				}),
				makeAssistant({ input_tokens: 80, output_tokens: 20 }),
			]),
		).toBe(480);
	});

	test("assistant message with undefined usage skipped (guard)", () => {
		// Virtual / error messages may omit usage — must not throw or miscount.
		const virtual = {
			type: "assistant",
			uuid: "u-virtual",
			timestamp: new Date().toISOString(),
			message: {
				id: "msg_virtual",
				type: "message",
				role: "assistant",
				model: "real-model",
				content: [{ type: "text", text: "virtual" }],
				stop_reason: "end_turn",
				// usage intentionally absent
			},
		} as unknown as Message;
		expect(
			sumAssistantMessageTokens([
				virtual,
				makeAssistant({ input_tokens: 100, output_tokens: 50 }),
			]),
		).toBe(150);
	});

	test("non-assistant messages ignored", () => {
		const userMsg = {
			type: "user",
			uuid: "u-user",
			timestamp: new Date().toISOString(),
			message: {
				role: "user",
				content: [{ type: "text", text: "hi" }],
			},
		} as unknown as Message;
		expect(
			sumAssistantMessageTokens([
				userMsg,
				makeAssistant({ input_tokens: 40, output_tokens: 10 }),
			]),
		).toBe(50);
	});

	test("synthetic messages excluded (no double-count)", () => {
		// getTokenUsage filters synthetic placeholders (SYNTHETIC_MESSAGES text +
		// SYNTHETIC_MODEL) — they carry no real spend and must not inflate the sum.
		const synthetic = makeAssistant({ input_tokens: 999, output_tokens: 999 });
		synthetic.message.content[0] = {
			type: "text",
			text: [...SYNTHETIC_MESSAGES][0] ?? "is_synthetic",
		} as AssistantMessage["message"]["content"][number];
		expect(
			sumAssistantMessageTokens([
				synthetic,
				makeAssistant({ input_tokens: 100, output_tokens: 50 }),
			]),
		).toBe(150);
	});

	test("synthetic-model messages excluded", () => {
		const syntheticModel = makeAssistant({
			input_tokens: 999,
			output_tokens: 999,
		});
		syntheticModel.message.model = SYNTHETIC_MODEL;
		expect(
			sumAssistantMessageTokens([
				syntheticModel,
				makeAssistant({ input_tokens: 100, output_tokens: 50 }),
			]),
		).toBe(150);
	});

	test("getTokenCountFromUsage contract (sum building block)", () => {
		expect(
			getTokenCountFromUsage({
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 30,
				cache_read_input_tokens: 200,
			} as Parameters<typeof getTokenCountFromUsage>[0]),
		).toBe(380);
		expect(
			getTokenCountFromUsage({
				input_tokens: 10,
				output_tokens: 5,
			} as Parameters<typeof getTokenCountFromUsage>[0]),
		).toBe(15);
	});
});
