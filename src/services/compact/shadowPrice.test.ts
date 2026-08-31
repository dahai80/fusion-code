// P1.2 (audit): 影子价压缩纯函数单测。
// fixture 约定: 每轮 = [assistant(id 唯一), user(tool_result)] 配对, 起 assistant。
// groupMessagesByApiRound 在新 assistant.id 处切边界, 故起 user tool_result 会被
// 切成独立轮 → 测试轮数错位。起 assistant 则轮 = [asst, tool_result] 一一对应。
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
	it("大结果 + 无引用 + 最旧轮 → 最高价", () => {
		const price = computeShadowPrice({
			sizeTokens: 8000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 5,
		});
		expect(price).toBeGreaterThan(0);
	});

	it("小结果 + 高引用 + 最新旧轮 → 低价", () => {
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

	it("引用越多越保 (价降)", () => {
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

	it("单轮 totalRounds=1 → recency 满分不除零", () => {
		const price = computeShadowPrice({
			sizeTokens: 1000,
			refCount: 0,
			roundIndex: 0,
			totalRounds: 1,
		});
		expect(Number.isFinite(price)).toBe(true);
	});

	it("size 主导: 同轮同引用, 大结果价高", () => {
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
	it("空消息 → 无候选", () => {
		expect(collectShadowPriceCandidates([], 3)).toEqual([]);
	});

	it("近期轮内不产生候选 (keepRecent)", () => {
		// 2 轮, keep 2 → 无旧轮 → 无候选。
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
			makeAssistant(`${UUID_BASE}4`, "b"),
			makeToolResultUser(`${UUID_BASE}3`, "tu_2", "y".repeat(100)),
		];
		expect(collectShadowPriceCandidates(msgs, 2)).toEqual([]);
	});

	it("旧轮大结果 → 候选 (按价降序)", () => {
		// round0 大结果, round1 小结果, keep 1 → 仅 round0 候选。
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

	it("被后续 assistant 引用的结果 → 价更低 (同轮同大小, 仅引用差)", () => {
		// round0 含两条同大小结果 (tu_ref / tu_noref); round1 assistant 文本提及 tu_ref。
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
	it("近期全保留 → 原样返回 (引用相等), 无裁剪, prefix boundary = length", () => {
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
		];
		const res = shadowPriceCompactMessages(msgs, 3, 2.0);
		expect(res.messages).toBe(msgs);
		expect(res.truncatedToolResults).toBe(0);
		expect(res.prefixBoundaryIndex).toBe(msgs.length);
		expect(res.prunedCandidateCount).toBe(0);
	});

	it("高价旧结果 → 截断, 低价旧结果 → 保留原样", () => {
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
		expect(res.prefixBoundaryIndex).toBeLessThan(res.messages.length);
	});

	it("阈值高 → 无结果达裁剪线 → 全保留, 引用相等", () => {
		const big = "B".repeat(20000);
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}1`, "a"),
			makeToolResultUser(`${UUID_BASE}2`, "tu_big", big),
			makeAssistant(`${UUID_BASE}3`, "b"),
		];
		// 阈值 100 → 无候选达线 → 不裁, 返回原引用。
		const res = shadowPriceCompactMessages(msgs, 1, 100);
		expect(res.truncatedToolResults).toBe(0);
		expect(res.prunedCandidateCount).toBe(0);
		expect(res.messages).toBe(msgs);
	});

	it("无 mutation 时 prefix boundary = length", () => {
		const msgs: Message[] = [
			makeAssistant(`${UUID_BASE}2`, "a"),
			makeToolResultUser(`${UUID_BASE}1`, "tu_1", "x".repeat(100)),
			makeAssistant(`${UUID_BASE}4`, "b"),
			makeToolResultUser(`${UUID_BASE}3`, "tu_2", "y".repeat(100)),
		];
		// keep 2 → 无旧轮 → 无 mutation。
		const res = shadowPriceCompactMessages(msgs, 2, 0.1);
		expect(res.prefixBoundaryIndex).toBe(msgs.length);
		expect(res.messages).toBe(msgs);
	});

	it("低价结果内容原样保留 (字面相等)", () => {
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
		// 找回 tu_small 的 tool_result block, 内容应与原 small 完全相等。
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
	it("env 未设 → false (default off)", () => {
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
