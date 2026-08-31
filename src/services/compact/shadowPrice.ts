// P1.2 (audit): 影子价压缩 — 工具结果代价模型 + 选择性裁剪。
// 影子价 = token 大小 (越大越值得裁) + 引用频次 (越少越值得裁) + 时近性 (越旧越值得裁)。
// 朴素 head/tail 截断改选择性裁: 高价结果截断, 低价结果保留原样 → 可复用前缀边界更长。
// 配 #2 直接服务 MLX KV-cache 复用 (压缩后缀, 保前缀)。
//
// default-off (FUSION_CODE_SHADOW_PRICE_COMPACT=1)。off = hardCompact 走原 head/tail 路径, byte-identical。
// 纯函数 (无副作用, 无 IO), 可单测。

import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "../../types/message.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { getAssistantMessageText } from "../../utils/messages.js";
import { roughTokenCountEstimationForMessages } from "../tokenEstimation.js";
import { groupMessagesByApiRound } from "./grouping.js";
import {
	ASSISTANT_TEXT_TRUNCATE_THRESHOLD_TOKENS,
	CHARS_PER_TOKEN_ESTIMATE,
	TOOL_RESULT_HEAD_CHARS,
	TOOL_RESULT_TAIL_CHARS,
	truncateAssistantText,
	truncateString,
	truncateToolResultContent,
} from "./hardCompact.js";

// 开关。off = 调用方走原 head/tail 路径 (byte-identical)。
export function isShadowPriceCompactEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_SHADOW_PRICE_COMPACT);
}

// 影子价权重 — 大小主导 (省 token 是首要目标), 频次/时近性次之。
const WEIGHT_SIZE = 0.6;
const WEIGHT_FREQ = 0.2;
const WEIGHT_RECENCY = 0.2;

// 影子价分。越高越值得裁 (省空间多, 被引用少, 越旧)。
// sizeTokens: 该结果 token 估算; refCount: 被后续 assistant 消息引用次数;
// roundIndex: 所在 round 索引; totalRounds: round 总数; recentBoost: 近期轮权重。
export interface ShadowPriceInputs {
	sizeTokens: number;
	refCount: number;
	roundIndex: number;
	totalRounds: number;
}

export function computeShadowPrice(inputs: ShadowPriceInputs): number {
	const { sizeTokens, refCount, roundIndex, totalRounds } = inputs;
	// size 分量: 归一化 (假设单结果上限 ~32K token, /1000 做 0..~32 区间)。
	const sizeScore = Math.min(sizeTokens / 1000, 32);
	// freq 分量: 引用越多越保 (代价降)。无引用 = 1.0 满代价; 10+ 引用 ≈ 0。
	const freqScore = 1 / (1 + refCount);
	// recency 分量: round 索引越小越旧 → 越值得裁。归一化 [0,1]。
	const recencyScore =
		totalRounds <= 1 ? 1 : 1 - roundIndex / (totalRounds - 1);
	const price =
		WEIGHT_SIZE * sizeScore +
		WEIGHT_FREQ * freqScore +
		WEIGHT_RECENCY * recencyScore;
	return price;
}

// 工具结果 token 估算 (字符 / 4)。
function estimateToolResultTokens(
	content: string | Array<Record<string, unknown>> | undefined,
): number {
	if (content === undefined) return 0;
	if (typeof content === "string") {
		return Math.ceil(content.length / CHARS_PER_TOKEN_ESTIMATE);
	}
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content) {
		if (block && typeof block === "object" && block.type === "text") {
			const text = (block as { text?: string }).text;
			if (typeof text === "string") chars += text.length;
		}
	}
	return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

// 候选: 一条可裁工具结果 + 其影子价。
export interface PruneCandidate {
	roundIndex: number;
	messageIndex: number;
	toolUseId: string | undefined;
	shadowPrice: number;
	sizeTokens: number;
}

// 扫描 messages, 对每条旧 round 的工具结果算影子价, 返回候选列表 (降序)。
// 近期 keepRecentRounds 轮不裁 (与原 hardCompact 一致)。
export function collectShadowPriceCandidates(
	messages: Message[],
	keepRecentRounds: number,
): PruneCandidate[] {
	const groups = groupMessagesByApiRound(messages);
	const totalRounds = groups.length;
	const roundsKeptIntact = Math.min(keepRecentRounds, totalRounds);
	const roundsToProcess = totalRounds - roundsKeptIntact;
	if (roundsToProcess <= 0) return [];

	// 先 seed 引用表 (所有 tool_use_id 初始 0), 再扫 assistant 文本累计。
	const refMap = new Map<string, number>();
	for (const msg of messages) {
		if (msg.type !== "user") continue;
		const content = (msg as UserMessage).message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			if (block.type !== "tool_result") continue;
			const id = (block as { tool_use_id?: string }).tool_use_id;
			if (id && !refMap.has(id)) refMap.set(id, 0);
		}
	}
	for (const msg of messages) {
		if (msg.type !== "assistant") continue;
		const text = getAssistantMessageText(msg as AssistantMessage);
		if (!text) continue;
		for (const [id, count] of refMap) {
			if (text.includes(id)) refMap.set(id, count + 1);
		}
	}

	const candidates: PruneCandidate[] = [];
	for (let i = 0; i < roundsToProcess; i++) {
		const group = groups[i];
		for (const msg of group) {
			if (msg.type !== "user") continue;
			const userMsg = msg as UserMessage;
			const content = userMsg.message?.content;
			if (!Array.isArray(content)) continue;
			for (let bi = 0; bi < content.length; bi++) {
				const block = content[bi];
				if (!block || typeof block !== "object") continue;
				if (block.type !== "tool_result") continue;
				const toolUseId = (block as { tool_use_id?: string }).tool_use_id;
				const originalContent = (block as { content?: unknown }).content as
					| string
					| Array<Record<string, unknown>>
					| undefined;
				const sizeTokens = estimateToolResultTokens(originalContent);
				const refCount = toolUseId ? (refMap.get(toolUseId) ?? 0) : 0;
				const shadowPrice = computeShadowPrice({
					sizeTokens,
					refCount,
					roundIndex: i,
					totalRounds,
				});
				candidates.push({
					roundIndex: i,
					messageIndex: bi,
					toolUseId,
					shadowPrice,
					sizeTokens,
				});
			}
		}
	}
	// 降序: 高价优先裁。
	candidates.sort((a, b) => b.shadowPrice - a.shadowPrice);
	return candidates;
}

// 影子价裁剪结果。
export interface ShadowPriceCompactResult {
	messages: Message[];
	truncatedToolResults: number;
	truncatedAssistantTexts: number;
	roundsKeptIntact: number;
	roundsProcessed: number;
	preCompactTokens: number;
	postCompactTokens: number;
	prefixBoundaryIndex: number; // 首个被改消息索引 (可复用前缀到此为止)
	prunedCandidateCount: number;
}

// 选择性影子价裁剪。仅裁高价工具结果 (高于阈值), 低价保留原样 → 可复用前缀更长。
// assistant 文本沿用原 hardCompact 策略 (超阈值截断)。
// keepRecentRounds: 近期保留轮数; priceThreshold: 高于此价才裁 (默认 2.0)。
export function shadowPriceCompactMessages(
	messages: Message[],
	keepRecentRounds: number = 3,
	priceThreshold: number = 2.0,
): ShadowPriceCompactResult {
	const preCompactTokens = roughTokenCountEstimationForMessages(
		messages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
	);
	const groups = groupMessagesByApiRound(messages);
	const totalRounds = groups.length;
	const roundsKeptIntact = Math.min(keepRecentRounds, totalRounds);
	const roundsToProcess = totalRounds - roundsKeptIntact;

	if (roundsToProcess <= 0) {
		logForDebugging(
			`[ShadowPrice] All ${totalRounds} rounds within keep range, nothing to compact`,
		);
		return {
			messages,
			truncatedToolResults: 0,
			truncatedAssistantTexts: 0,
			roundsKeptIntact: totalRounds,
			roundsProcessed: 0,
			preCompactTokens,
			postCompactTokens: preCompactTokens,
			prefixBoundaryIndex: messages.length,
			prunedCandidateCount: 0,
		};
	}

	const candidates = collectShadowPriceCandidates(messages, keepRecentRounds);
	// 高价集合 (要裁): toolUseId → price。
	const pruneSet = new Map<string, number>();
	let prunedCandidateCount = 0;
	for (const c of candidates) {
		if (c.shadowPrice >= priceThreshold && c.toolUseId) {
			pruneSet.set(c.toolUseId, c.shadowPrice);
			prunedCandidateCount++;
		}
	}

	const result: Message[] = [];
	let truncatedToolResults = 0;
	let truncatedAssistantTexts = 0;
	let firstMutatedIndex = -1;

	for (let i = 0; i < groups.length; i++) {
		const isOld = i < roundsToProcess;
		if (!isOld) {
			result.push(...groups[i]);
			continue;
		}
		for (const msg of groups[i]) {
			if (msg.type === "user") {
				const userMsg = msg as UserMessage;
				const content = userMsg.message?.content;
				if (Array.isArray(content)) {
					let didTruncate = false;
					const newContent = content.map((block) => {
						if (!block || typeof block !== "object") return block;
						if (block.type !== "tool_result") return block;
						const toolUseId = (block as { tool_use_id?: string }).tool_use_id;
						// 仅高价候选裁; 低价原样保留。
						if (!toolUseId || !pruneSet.has(toolUseId)) return block;
						const originalContent = (block as { content?: unknown }).content as
							| string
							| Array<Record<string, unknown>>
							| undefined;
						if (originalContent === undefined) return block;
						const truncated = truncateToolResultContent(originalContent);
						if (truncated !== originalContent) {
							didTruncate = true;
							truncatedToolResults++;
							return { ...block, content: truncated };
						}
						return block;
					});
					if (didTruncate) {
						if (firstMutatedIndex === -1) firstMutatedIndex = result.length;
						result.push({
							...userMsg,
							message: {
								...userMsg.message,
								content: newContent as typeof userMsg.message.content,
							},
						});
						continue;
					}
				}
				result.push(msg);
			} else if (msg.type === "assistant") {
				const asstMsg = msg as AssistantMessage;
				const textContent = getAssistantMessageText(asstMsg);
				if (
					textContent &&
					textContent.length >
						ASSISTANT_TEXT_TRUNCATE_THRESHOLD_TOKENS * CHARS_PER_TOKEN_ESTIMATE
				) {
					const truncatedText = truncateAssistantText(textContent);
					if (truncatedText !== textContent) {
						truncatedAssistantTexts++;
						const newContent = asstMsg.message.content.map((block) => {
							if (
								block.type === "text" &&
								typeof (block as unknown as Record<string, unknown>).text ===
									"string"
							) {
								const textBlock = block as { type: "text"; text: string };
								if (textBlock.text === textContent) {
									return { ...textBlock, text: truncatedText };
								}
							}
							return block;
						});
						if (firstMutatedIndex === -1) firstMutatedIndex = result.length;
						result.push({
							...asstMsg,
							message: {
								...asstMsg.message,
								content: newContent as typeof asstMsg.message.content,
							},
						});
						continue;
					}
				}
				result.push(msg);
			} else {
				result.push(msg);
			}
		}
	}

	// 无 mutation → 返回原数组引用 (no-op 契约: 调用方可安全 === 判等)。
	// 有 mutation → 返回新数组, prefixBoundaryIndex = 首个被改索引 (可复用前缀到此)。
	const finalMessages = firstMutatedIndex === -1 ? messages : result;
	const postCompactTokens = roughTokenCountEstimationForMessages(
		finalMessages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
	);
	const prefixBoundaryIndex =
		firstMutatedIndex === -1 ? messages.length : firstMutatedIndex;
	logForDebugging(
		`[ShadowPrice] Processed ${roundsToProcess}/${totalRounds} rounds, ` +
			`pruned ${truncatedToolResults} tool_results (candidates=${prunedCandidateCount}), ` +
			`truncated ${truncatedAssistantTexts} assistant texts, ` +
			`prefix boundary = ${prefixBoundaryIndex}, ` +
			`tokens ${preCompactTokens} → ${postCompactTokens}`,
	);

	return {
		messages: finalMessages,
		truncatedToolResults,
		truncatedAssistantTexts,
		roundsKeptIntact,
		roundsProcessed: roundsToProcess,
		preCompactTokens,
		postCompactTokens,
		prefixBoundaryIndex,
		prunedCandidateCount,
	};
}

// 复用 hardCompact 常量入口 (避免重复定义; 改 hardCompact 时改一处)。
export { TOOL_RESULT_HEAD_CHARS, TOOL_RESULT_TAIL_CHARS, truncateString };
