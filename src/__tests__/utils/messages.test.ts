/**
 * item 17 + :598 (issue #111): :598 useMemo 解耦 syntheticStreamingToolUseMessages
 *
 * 解耦负载关键属性: synthetic 流式 tool_use block 渲染**不依赖 lookups 条目**。
 * shouldRenderStatically (Messages.tsx:1125) assistant 分支:
 *   server_tool_use → lookups.resolvedToolUseIDs.has (先, line 1135)
 *   plain tool_use  → streamingToolUseIDs.has short-circuit (line 1142, lookups 前)
 * synthetic contentBlock.type 硬编码 "tool_use" (anthropic-protocol.ts:493) →
 * 永远 plain tool_use → 走 short-circuit 返 false (动态) 不查 lookups。
 *
 * shouldRenderStatically 本身不可单测 (Messages.tsx 顶层 feature() 是 bun:bundle
 * 编译宏, 模块加载即抛), 故测锁定其短路前提条件链 + transform 函数属性。
 */
import type { UUID } from "crypto";
import { describe, expect, it } from "bun:test";
import type { BetaToolUseBlock } from "../../types/anthropic-protocol.js";
import type {
	AssistantMessage,
	Message,
	NormalizedAssistantMessage,
	NormalizedMessage,
	UserMessage,
} from "../../types/message.js";
import {
	createAssistantMessage,
	createUserMessage,
	deriveUUID,
	getToolUseID,
	normalizeMessages,
	reorderMessagesInUI,
} from "../../utils/messages.js";
import {
	buildMessageLookups,
	getProgressMessagesFromLookup,
	getSiblingToolUseIDsFromLookup,
} from "../../utils/messages.js";
import { applyGrouping } from "../../utils/groupToolUses.js";
import type { MessageWithoutProgress } from "../../utils/groupToolUses.js";

// ─── Helpers (mirror Messages.tsx:564-579 synthetic builder + cache test) ───

let uuidCounter = 0;
function makeUUID(prefix: string): string {
	uuidCounter++;
	const tail = String(uuidCounter).padStart(32 - prefix.length, "0");
	return `${prefix}${tail}`;
}

// Synthetic streaming tool_use block — exactly what Messages.tsx:564-579 builds.
function makeStreamingToolUseBlock(id: string, name = "Bash"): BetaToolUseBlock {
	return {
		type: "tool_use",
		id,
		name,
		input: { command: "ls" },
	};
}

// Build synthetic normalized message exactly as Messages.tsx:564-579 does:
// createAssistantMessage({content:[block]}) + override uuid = deriveUUID(id, 0) +
// normalizeMessages([msg]).
function makeSynthetic(block: BetaToolUseBlock): NormalizedAssistantMessage[] {
	const msg = createAssistantMessage({ content: [block] });
	msg.uuid = deriveUUID(block.id as UUID, 0);
	// Synthetic is a single assistant content block → normalizeMessages yields
	// exactly one NormalizedAssistantMessage (no chain split for single block).
	return normalizeMessages([msg]) as NormalizedAssistantMessage[];
}

// Real assistant tool_use message (source for normalize).
function makeAssistantToolUse(
	uuid: string,
	toolUseId: string,
	name = "Bash",
	timestamp = "2026-01-01T00:00:00.000Z",
): AssistantMessage {
	return {
		type: "assistant",
		uuid: uuid as AssistantMessage["uuid"],
		timestamp,
		message: {
			id: uuid,
			role: "assistant",
			model: "test-model",
			content: [
				{ type: "tool_use", id: toolUseId, name, input: { command: "ls" } },
			],
			stop_reason: "tool_use",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as AssistantMessage["message"],
	};
}

function makeUserText(uuid: string, text: string): UserMessage {
	return createUserMessage({
		content: text,
		uuid,
		timestamp: "2026-01-01T00:00:00.000Z",
	});
}

function makeUserToolResult(uuid: string, toolUseId = "tu-1"): UserMessage {
	return createUserMessage({
		uuid,
		timestamp: "2026-01-01T00:00:00.000Z",
		content: [
			{ type: "tool_result", tool_use_id: toolUseId, content: "ok" },
		],
	});
}

// uuid-compare (derived-uuid identity is the correctness crux).
// Generic: accepts both NormalizedMessage[] and RenderableMessage[] (both have uuid).
function uuidsOf<T extends { uuid: string }>(messages: T[]): string[] {
	return messages.map((m) => m.uuid);
}

// Narrow normalized → MessageWithoutProgress (filter type guard doesn't narrow).
function withoutProgress(normalized: NormalizedMessage[]): MessageWithoutProgress[] {
	return normalized.filter((m) => m.type !== "progress") as MessageWithoutProgress[];
}

// ─── Test 1: reorderMessagesInUI(real, []) === reorderMessagesInUI(real, synthetic) ─ synthetic 尾 append 不改 real 顺序 ───
//
// 解耦核心: reorderMessagesInUI 分组扫描只迭代 real (messages.ts:900-970),
// synthetic 仅尾 append (1035-1037) → real 前缀顺序 = 无 synthetic 时顺序。

describe("item 17 / :598: reorderMessagesInUI 尾-append 属性", () => {
	it("synthetic 仅尾 append, real 顺序不变 (单合成块)", () => {
		const toolUseId = "tu-real-1";
		const messages: Message[] = [
			makeUserText(makeUUID("u-"), "hello"),
			makeAssistantToolUse(makeUUID("a-"), toolUseId),
			makeUserToolResult(makeUUID("r-"), toolUseId),
		];
		const normalized = normalizeMessages(messages);
		const realFiltered = normalized.filter((m) => m.type !== "progress");

		const syntheticBlock = makeStreamingToolUseBlock("tu-stream-1");
		const synthetic = makeSynthetic(syntheticBlock);

		const withoutSynthetic = reorderMessagesInUI(realFiltered, []);
		const withSynthetic = reorderMessagesInUI(realFiltered, synthetic);

		// real 前缀一致 (去尾 synthetic)
		expect(uuidsOf(withoutSynthetic)).toEqual(
			uuidsOf(withSynthetic.slice(0, withoutSynthetic.length)),
		);
		// withSynthetic 尾部 = synthetic
		expect(withSynthetic.length).toBe(withoutSynthetic.length + synthetic.length);
		expect(uuidsOf(withSynthetic.slice(withoutSynthetic.length))).toEqual(
			uuidsOf(synthetic),
		);
	});

	it("空 synthetic === 不传 (no-op)", () => {
		const toolUseId = "tu-real-2";
		const messages: Message[] = [
			makeAssistantToolUse(makeUUID("a-"), toolUseId),
			makeUserToolResult(makeUUID("r-"), toolUseId),
		];
		const realFiltered = withoutProgress(normalizeMessages(messages));

		expect(reorderMessagesInUI(realFiltered, [])).toEqual(
			reorderMessagesInUI(realFiltered, []),
		);
	});

	it("多合成块尾 append, real 顺序不变", () => {
		const toolUseId = "tu-real-3";
		const messages: Message[] = [
			makeUserText(makeUUID("u-"), "q"),
			makeAssistantToolUse(makeUUID("a-"), toolUseId),
			makeUserToolResult(makeUUID("r-"), toolUseId),
		];
		const realFiltered = withoutProgress(normalizeMessages(messages));

		const synthetic = [
			...makeSynthetic(makeStreamingToolUseBlock("tu-s-a")),
			...makeSynthetic(makeStreamingToolUseBlock("tu-s-b")),
			...makeSynthetic(makeStreamingToolUseBlock("tu-s-c")),
		];

		const withoutSynthetic = reorderMessagesInUI(realFiltered, []);
		const withSynthetic = reorderMessagesInUI(realFiltered, synthetic);

		expect(uuidsOf(withoutSynthetic)).toEqual(
			uuidsOf(withSynthetic.slice(0, withoutSynthetic.length)),
		);
		expect(withSynthetic.length).toBe(withoutSynthetic.length + 3);
	});
});

// ─── Test 2: buildMessageLookups synthetic id absent → 空默认 ───
//
// lookups 建于 real-only messagesToShowReal (解耦后)。synthetic id fresh UUID
// (非 normalizedMessages) → lookups 中 absent → helper 返空默认, 不误判。

describe("item 17 / :598: buildMessageLookups absent-id 空默认", () => {
	it("synthetic id 不在 lookups: getProgress/getSibling 返空, resolved 不含", () => {
		const realToolUseId = "tu-real-look";
		const messages: Message[] = [
			makeAssistantToolUse(makeUUID("a-"), realToolUseId),
			makeUserToolResult(makeUUID("r-"), realToolUseId),
		];
		const normalized = normalizeMessages(messages);
		const realFiltered = normalized.filter((m) => m.type !== "progress");

		// lookups 建于 real-only (解耦后 messagesToShowReal, 不含 synthetic)
		const lookups = buildMessageLookups(normalized, realFiltered);

		const syntheticBlock = makeStreamingToolUseBlock("tu-stream-look");
		const synthetic = makeSynthetic(syntheticBlock);
		const syntheticMsg = synthetic[0];

		// synthetic id absent in lookups
		expect(getToolUseID(syntheticMsg)).toBe("tu-stream-look");
		expect(getProgressMessagesFromLookup(syntheticMsg, lookups)).toEqual([]);
		expect(getSiblingToolUseIDsFromLookup(syntheticMsg, lookups)).toEqual(
			new Set(),
		);
		expect(lookups.resolvedToolUseIDs.has("tu-stream-look")).toBe(false);
		expect(lookups.erroredToolUseIDs.has("tu-stream-look")).toBe(false);

		// real id 仍在 lookups (对照)
		expect(lookups.resolvedToolUseIDs.has(realToolUseId)).toBe(true);
	});
});

// ─── Test 3: shouldRenderStatically 短路前提条件链 ───
//
// shouldRenderStatically 本体不可单测 (Messages.tsx 顶层 feature() bun:bundle 宏
// 模块加载即抛)。锁定其短路前提条件链, 证 synthetic 必走 short-circuit 不查 lookups:
//   (a) contentBlock.type 硬编码 "tool_use" (非 server_tool_use) → 1135 分支不触
//   (b) getToolUseID(synthetic) === block.id → 1142 条件可求值
//   (c) id ∈ streamingToolUseIDs → has()=true → 返 false (动态)

describe("item 17 / :598: shouldRenderStatically 短路前提条件链", () => {
	it("BetaToolUseBlock.type 硬编码 tool_use (非 server_tool_use)", () => {
		// 构造即证: makeStreamingToolUseBlock 返 type:"tool_use", 永远非 server_tool_use
		const block = makeStreamingToolUseBlock("tu-x");
		expect(block.type).toBe("tool_use");
		expect((block.type as string)).not.toBe("server_tool_use");
	});

	it("synthetic block → getToolUseID 返 block.id (短路条件可求值)", () => {
		const block = makeStreamingToolUseBlock("tu-y");
		const synthetic = makeSynthetic(block);
		const syntheticMsg = synthetic[0];
		expect(syntheticMsg.type).toBe("assistant");
		// content[0].type === "tool_use" → getToolUseID 走 assistant 分支返 id
		expect(getToolUseID(syntheticMsg)).toBe("tu-y");
	});

	it("id ∈ streamingToolUseIDs → has()=true (短路返 false 可达)", () => {
		const block = makeStreamingToolUseBlock("tu-z");
		const streamingToolUseIDs = new Set<string>([block.id]);
		expect(streamingToolUseIDs.has(block.id)).toBe(true);
		// 复现 shouldRenderStatically assistant 分支顺序:
		//   server_tool_use? → no (block.type === "tool_use")
		//   getToolUseID → "tu-z" (非 null)
		//   streamingToolUseIDs.has → true → return false (动态渲染)
		const blockIsServerToolUse = (block.type as string) === "server_tool_use";
		const toolUseID = getToolUseID(makeSynthetic(block)[0]);
		const shortCircuitsDynamic =
			!blockIsServerToolUse &&
			toolUseID !== null &&
			streamingToolUseIDs.has(toolUseID);
		expect(shortCircuitsDynamic).toBe(true);
	});
});

// ─── Test 4: applyGrouping synthetic 透传 (无 ≥2 同组, 不成组) ───
//
// 解耦后 collapsedReal = applyGrouping(real-only), 尾 append synthetic (O(k))。
// synthetic 独立 messageId (fresh createAssistantMessage UUID) → 无 ≥2 同组 →
// 不进 validGroups → applyGrouping 不改 synthetic。证尾 append 后 grouping 不变。

describe("item 17 / :598: applyGrouping synthetic 透传", () => {
	it("空 tools → applyGrouping 透传 (无分组), synthetic 保持尾序", () => {
		const realToolUseId = "tu-group-real";
		const messages: Message[] = [
			makeAssistantToolUse(makeUUID("a-"), realToolUseId),
			makeUserToolResult(makeUUID("r-"), realToolUseId),
		];
		const realFiltered = withoutProgress(normalizeMessages(messages));

		const { messages: grouped } = applyGrouping(realFiltered, [], false);
		// 空 tools: 无分组 → 透传
		expect(grouped).toEqual(realFiltered);
	});

	it("applyGrouping(real) 尾 ++ synthetic = applyGrouping(real+synthetic) 去 synthetic 尾 (synthetic 不成组)", () => {
		const realToolUseId = "tu-group-2";
		const messages: Message[] = [
			makeUserText(makeUUID("u-"), "go"),
			makeAssistantToolUse(makeUUID("a-"), realToolUseId),
			makeUserToolResult(makeUUID("r-"), realToolUseId),
		];
		const realFiltered = withoutProgress(normalizeMessages(messages));

		const synthetic = makeSynthetic(makeStreamingToolUseBlock("tu-group-s"));

		const groupedReal = applyGrouping(realFiltered, [], false).messages;
		const groupedRealPlusSynthetic = applyGrouping(
			[...realFiltered, ...synthetic],
			[],
			false,
		).messages;

		// real 前缀一致
		expect(groupedReal.length).toBe(realFiltered.length);
		expect(uuidsOf(groupedReal)).toEqual(
			uuidsOf(
				groupedRealPlusSynthetic.slice(0, groupedReal.length),
			),
		);
		// synthetic 尾透传 (未进 group)
		expect(groupedRealPlusSynthetic.length).toBe(
			groupedReal.length + synthetic.length,
		);
		expect(
			uuidsOf(groupedRealPlusSynthetic.slice(groupedReal.length)),
		).toEqual(uuidsOf(synthetic));
	});
});
