// P1.2 (audit): unit tests for the shadow-price compaction pure functions.
// Fixture convention: each round = [assistant(id unique), user(tool_result)] pair, starting with an assistant.
// groupMessagesByApiRound cuts a boundary at each new assistant.id, so starting with a user
// tool_result would split it into its own round → test round counts misalign. Starting with an
// assistant makes round = [asst, tool_result] map one-to-one.
import { describe, expect, it } from "bun:test";
import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "../../types/message.js";
import { createUserMessage } from "../../utils/messages.js";
import {
	collectShadowPriceCandidates,
	computeShadowPrice,
	isShadowPriceCompactEnabled,
	shadowPriceCompactMessages,
} from "./shadowPrice.js";

const UUID_BASE = "00000000-0000-4000-8000-0000000000";

function makeToolResultUser(
	uuid: string,
	toolUseId: string,
	resultText: string,
): UserMessage {
	return {
		...createUserMessage({
			content: "ignored",
			uuid,
			timestamp: "2026-01-01T00:00:00.000Z",
		}),
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: resultText,
				},
			],
		},
	};
}

function makeAssistant(uuid: string, text: string): AssistantMessage {
	return {
		type: "assistant",
		uuid: uuid as AssistantMessage["uuid"],
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			id: uuid,
			role: "assistant",
			model: "test-model",
			content: [{ type: "text", text }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as AssistantMessage["message"],
	};
}

describe("computeShadowPrice", () => {
	it("big result + no refs + oldest round → highest price", () => {
		const price = computeShadowPrice({
			sizeTokens: 8000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 5,
		});
		expect(price).toBeGreaterThan(0);
	});

	it("small result + high refs + most recent old round → low price", () => {
		const priceOld = computeShadowPrice({
			sizeTokens: 8000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 5,
		});
		const priceCheap = computeShadowPrice({
			sizeTokens: 50,
			refCount: 10,
			roundIndex: 3,
			totalRounds: 5,
		});
		expect(priceCheap).toBeLessThan(priceOld);
	});

	it("more refs = more likely kept (price drops)", () => {
		const p0 = computeShadowPrice({
			sizeTokens: 4000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 4,
		});
		const p5 = computeShadowPrice({
			sizeTokens: 4000,
			refCount: 5,
			roundIndex: 0,
			totalRounds: 4,
		});
		expect(p5).toBeLessThan(p0);
	});

	it("single round totalRounds=1 → recency full score, no division by zero", () => {
		const price = computeShadowPrice({
			sizeTokens: 1000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 1,
		});
		expect(Number.isFinite(price)).toBe(true);
	});

	it("size dominates: same round, same refs, bigger result prices higher", () => {
		const small = computeShadowPrice({
			sizeTokens: 100,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 3,
		});
		const big = computeShadowPrice({
			sizeTokens: 10000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 3,
		});
		expect(big).toBeGreaterThan(small);
	});
});

describe("collectShadowPriceCandidates", () => {
	it("empty messages → no candidates", () => {
		expect(collectShadowPriceCandidates([], 3)).toEqual([]);
	});

	it("no candidates within recent rounds (keepRecent)", () => {
		// 2 rounds, keep 2 → no old rounds → no candidates.
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
			makeAssistant(`${UUID_BASE}4`, "b"),
			makeToolResultUser(`${UUID_BASE}3`, "tu_2", "y".repeat(100)),
		];
		expect(collectShadowPriceCandidates(msgs, 2)).toEqual([]);
	});

	it("old-round big result → candidate (sorted by price descending)", () => {
		// round0 big result, round1 small result, keep 1 → only round0 is a candidate.
		const big = "B".repeat(20000);
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_big", big),
			makeAssistant(`${UUID_BASE}4`, "b"),
			makeToolResultUser(`${UUID_BASE}3`, "tu_small", "s"),
		];
		const cands = collectShadowPriceCandidates(msgs, 1);
		expect(cands.length).toBe(1);
		expect(cands[0].toolUseId).toBe("tu_big");
		expect(cands[0].roundIndex).toBe(0);
	});

	it("result referenced by a later assistant → lower price (same round, same size, refs differ)", () => {
		// round0 holds two same-size results (tu_ref / tu_noref); round1's assistant text mentions tu_ref.
		const same = "R".repeat(5000);
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}1`, "first"),
			makeToolResultUser(`${UUID_BASE}2`, "tu_ref", same),
			makeToolResultUser(`${UUID_BASE}3`, "tu_noref", same),
			makeAssistant(`${UUID_BASE}4`, "see tu_ref here"),
		];
		const cands = collectShadowPriceCandidates(msgs, 1);
		const refCand = cands.find((c) => c.toolUseId === "tu_ref");
		const norefCand = cands.find((c) => c.toolUseId === "tu_noref");
		expect(refCand?.shadowPrice).toBeLessThan(
			norefCand?.shadowPrice ?? Infinity,
		);
	});
});

describe("shadowPriceCompactMessages", () => {
	it("all recent rounds kept → returned as-is (reference equality), no pruning", () => {
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
		];
		const res = shadowPriceCompactMessages(msgs, 3, 2.0);
		expect(res.messages).toBe(msgs);
		expect(res.truncatedToolResults).toBe(0);
		expect(res.prunedCandidateCount).toBe(0);
	});

	it("high-price old result → truncated, low-price old result → kept as-is", () => {
		const big = "B".repeat(20000);
		const small = "S".repeat(50);
		// round0=big, round1=small, round2=kept(asst only).
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}1`, "a"),
			makeToolResultUser(`${UUID_BASE}2`, "tu_big", big),
			makeAssistant(`${UUID_BASE}3`, "b"),
			makeToolResultUser(`${UUID_BASE}4`, "tu_small", small),
			makeAssistant(`${UUID_BASE}5`, "c"),
		];
		const res = shadowPriceCompactMessages(msgs, 1, 2.0);
		expect(res.truncatedToolResults).toBe(1);
		expect(res.prunedCandidateCount).toBe(1);
		expect(res.postCompactTokens).toBeLessThan(res.preCompactTokens);
	});

	it("threshold too high → no result reaches the prune line → all kept, reference equality", () => {
		const big = "B".repeat(20000);
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}1`, "a"),
			makeToolResultUser(`${UUID_BASE}2`, "tu_big", big),
			makeAssistant(`${UUID_BASE}3`, "b"),
		];
		// Threshold 100 → no candidate reaches the line → no pruning, original reference returned.
		const res = shadowPriceCompactMessages(msgs, 1, 100);
		expect(res.truncatedToolResults).toBe(0);
		expect(res.prunedCandidateCount).toBe(0);
		expect(res.messages).toBe(msgs);
	});

	it("no mutation → returns the original reference (reference equality)", () => {
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
			makeAssistant(`${UUID_BASE}4`, "b"),
			makeToolResultUser(`${UUID_BASE}3`, "tu_2", "y".repeat(100)),
		];
		// keep 2 → no old rounds → no mutation → original reference returned.
		const res = shadowPriceCompactMessages(msgs, 2, 0.1);
		expect(res.messages).toBe(msgs);
	});

	it("low-price result content preserved as-is (literal equality)", () => {
		const small = "S".repeat(50);
		const big = "B".repeat(20000);
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}1`, "a"),
			makeToolResultUser(`${UUID_BASE}2`, "tu_big", big),
			makeAssistant(`${UUID_BASE}3`, "b"),
			makeToolResultUser(`${UUID_BASE}4`, "tu_small", small),
			makeAssistant(`${UUID_BASE}5`, "c"),
		];
		const res = shadowPriceCompactMessages(msgs, 1, 2.0);
		// Find back tu_small's tool_result block; its content must equal the original small exactly.
		const smallUser = res.messages.find(
			(m) =>
				m.type === "user" &&
				Array.isArray((m as UserMessage).message?.content) &&
				((m as UserMessage).message.content[0] as { tool_use_id?: string })
					?.tool_use_id === "tu_small",
		) as UserMessage | undefined;
		const block = smallUser?.message?.content?.[0] as
			| { type: string; tool_use_id?: string; content?: unknown }
			| undefined;
		expect(block?.content).toBe(small);
	});
});

describe("isShadowPriceCompactEnabled", () => {
	it("env unset → false (default off)", () => {
		const saved = process.env.FUSION_CODE_SHADOW_PRICE_COMPACT;
		delete process.env.FUSION_CODE_SHADOW_PRICE_COMPACT;
		expect(isShadowPriceCompactEnabled()).toBe(false);
		if (saved !== undefined)
			process.env.FUSION_CODE_SHADOW_PRICE_COMPACT = saved;
	});

	it("env=1 → true", () => {
		const saved = process.env.FUSION_CODE_SHADOW_PRICE_COMPACT;
		process.env.FUSION_CODE_SHADOW_PRICE_COMPACT = "1";
		expect(isShadowPriceCompactEnabled()).toBe(true);
		if (saved === undefined)
			delete process.env.FUSION_CODE_SHADOW_PRICE_COMPACT;
		else process.env.FUSION_CODE_SHADOW_PRICE_COMPACT = saved;
	});
});
