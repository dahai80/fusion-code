// 审计 v3-0913 P1 断言用例: 截断重试后 finalMessageCount 必须反映实际
// 发送轮次, 而非原始长度。重构后 caller 局部变量不再被循环回写 (回写封闭
// 在 runCompactSummaryWithTruncateRetry 内), 元数据统计
// (summarizeMetadata.messagesSummarized) 消费共享函数的返回值——本用例
// 通过 DI 测试缝 (streamFn) 注入受控 stub, 模拟 PTL 截断重试轮次。

import { describe, expect, test } from "bun:test";
import { runCompactSummaryWithTruncateRetry } from "../../services/compact/index.js";
import type { ToolUseContext } from "../../Tool.js";
import type { AssistantMessage, Message } from "../../types/message.js";
import {
	createAssistantAPIErrorMessage,
	createUserMessage,
} from "../../utils/messages.js";

const PTL_TEXT = "Prompt is too long: 999999 tokens > 200000 token maximum";

function makeContext(): ToolUseContext {
	return {
		onCompactProgress: undefined,
		getAppState: () => ({}),
	} as unknown as ToolUseContext;
}

function makeMessages(rounds: number): Message[] {
	// groupMessagesByApiRound 的唯一边界门控是 assistant message.id 变化
	// (grouping.ts:44-48), 所以每条 assistant 必须带唯一 id, 否则全部并成
	// 1 组, truncateHeadForPTLRetry 无组可丢 (groups.length < 2 → null)。
	// 构造 [assistant,user]*rounds, 共 rounds 组, 每组 2 条。
	const msgs: Message[] = [];
	for (let i = 0; i < rounds; i++) {
		msgs.push({
			type: "assistant",
			message: {
				id: `assistant-${i}`,
				content: [{ type: "text", text: `a-${i}` }],
			},
		} as unknown as Message);
		msgs.push(createUserMessage({ content: `user-${i}` }));
	}
	return msgs;
}

function ptlResponse(): AssistantMessage {
	// 注意签名: createAssistantAPIErrorMessage 的参数是 content (非 errorText),
	// 文本需以 PROMPT_TOO_LONG_ERROR_MESSAGE ("Prompt is too long") 开头才能
	// 命中共享函数的 needsTruncateRetry 判定。
	return createAssistantAPIErrorMessage({
		content: PTL_TEXT,
	}) as unknown as AssistantMessage;
}

function okResponse(text = "summary"): AssistantMessage {
	return {
		type: "assistant",
		message: { content: [{ type: "text", text }] },
	} as unknown as AssistantMessage;
}

describe("runCompactSummaryWithTruncateRetry finalMessageCount (audit v3 P1)", () => {
	test("no retry: finalMessageCount = original length", async () => {
		const calls: Message[][] = [];
		const result = await runCompactSummaryWithTruncateRetry({
			messages: makeMessages(6), // 12 条 (6 组 × 2 条)
			summaryRequest: createUserMessage({ content: "summarize" }),
			appState: {} as never,
			context: makeContext(),
			preCompactTokenCount: 100,
			cacheSafeParams: {} as never,
			logPrefix: "[Test]",
			logFailed: () => {},
			streamFn: async ({ messages }) => {
				calls.push(messages);
				return okResponse();
			},
		});
		expect(calls.length).toBe(1);
		expect(result.finalMessageCount).toBe(12);
	});

	test("PTL retried until truncation succeeds: finalMessageCount = truncated count, not original", async () => {
		// stub 策略: 模拟 truncateHeadForPTLRetry 的轮次组丢弃 — 每次调用
		// 丢弃最旧一半, 直到 <= 1 组后返回成功。3 轮重试后 8 -> 4 -> 2 -> 1。
		const calls: Message[][] = [];
		const result = await runCompactSummaryWithTruncateRetry({
			messages: makeMessages(8),
			summaryRequest: createUserMessage({ content: "summarize" }),
			appState: {} as never,
			context: makeContext(),
			preCompactTokenCount: 100,
			cacheSafeParams: {} as never,
			logPrefix: "[Test]",
			logFailed: () => {},
			streamFn: async ({ messages }) => {
				calls.push(messages);
				// 合成响应无 errorDetails → tokenGap=undefined → 20% 回退:
				// 每轮只丢 1 组 (3 条), marker 补 1 条 → 17→15
				if (calls.length === 1) {
					return ptlResponse();
				}
				return okResponse("done");
			},
		});
		// 16 -> 15: 一次 PTL + 一次截断后成功 (20% 回退丢 1 组 = 2 条, 剥旧
		// marker 后 assistant-first → 补 synthetic marker, 净 -1)
		expect(calls.length).toBe(2);
		// 核心断言: 实际发送轮次 = 15 (截断后), 不是原始 16
		expect(result.finalMessageCount).toBe(15);
		expect(result.summary).toBe("done");
	});

	test("PTL exhausts retries: throws (caller logFailed path), no silent success", async () => {
		const result = runCompactSummaryWithTruncateRetry({
			messages: makeMessages(2),
			summaryRequest: createUserMessage({ content: "summarize" }),
			appState: {} as never,
			context: makeContext(),
			preCompactTokenCount: 100,
			cacheSafeParams: {} as never,
			logPrefix: "[Test]",
			logFailed: () => {},
			streamFn: async () => ptlResponse(),
		});
		// 永远 PTL → 无法再截断 → throw, 不得静默返回成功
		expect(result).rejects.toThrow(/too long/i);
	});
});
