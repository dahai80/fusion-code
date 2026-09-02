// Hard Compact: deterministic tool output truncation for MLX models
// Importers: compact.ts (compactConversation MLX branch), autoCompact.ts
// User instruction: "深度研读 suggest1.md和suggest2.md 制定方案和计划，修复问题，提升fusion-code竞争力"
// suggest1.md core insight: "让 LLM 去生成摘要在本地架构下是逻辑悖论" — LLM summarization during compact makes memory worse
// API: hardCompactMessages() returns HardCompactResult, shouldUseHardCompact() checks MLX provider
// Data schema: HardCompactResult { messages, truncatedToolResults, truncatedAssistantTexts, roundsKeptIntact, roundsProcessed, preCompactTokens, postCompactTokens }

import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "../../types/message.js";
import { getContextWindowForModel } from "../../utils/context.js";
import { logForDebugging } from "../../utils/debug.js";
import { getAssistantMessageText } from "../../utils/messages.js";
import { getMainLoopModel } from "../../utils/model/model.js";
import { isFusionMlxProvider } from "../../utils/model/providers.js";
import { roughTokenCountEstimationForMessages } from "../tokenEstimation.js";
import { groupMessagesByApiRound } from "./grouping.js";
import {
	isShadowPriceCompactEnabled,
	type PruneCandidate,
	shadowPriceCompactMessages,
} from "./shadowPrice.js";

export const TOOL_RESULT_HEAD_CHARS = 200;
export const TOOL_RESULT_TAIL_CHARS = 100;
const ASSISTANT_TEXT_MAX_TOKENS = 500;
export const ASSISTANT_TEXT_TRUNCATE_THRESHOLD_TOKENS = 1000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_KEEP_RECENT_ROUNDS = 3;

export interface HardCompactResult {
	messages: Message[];
	truncatedToolResults: number;
	truncatedAssistantTexts: number;
	roundsKeptIntact: number;
	roundsProcessed: number;
	preCompactTokens: number;
	postCompactTokens: number;
	// insight-0902 E3: 影子价候选评分表 (仅 shadow-price 路径填充), 供 /diff-compaction 审计。
	candidates?: PruneCandidate[];
	priceThreshold?: number;
}

function estimateTokensFromChars(charCount: number): number {
	return Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);
}

export function truncateString(
	s: string,
	headChars: number,
	tailChars: number,
): string {
	if (s.length <= headChars + tailChars + 50) return s;
	const head = s.slice(0, headChars);
	const tail = s.slice(-tailChars);
	const removed = s.length - headChars - tailChars;
	return `${head}\n[truncated: ${removed} chars removed]\n${tail}`;
}

export function truncateToolResultContent(
	content: string | Array<Record<string, unknown>>,
): string | Array<Record<string, unknown>> {
	if (typeof content === "string") {
		if (
			content.length <=
			TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS + 50
		) {
			return content;
		}
		return truncateString(
			content,
			TOOL_RESULT_HEAD_CHARS,
			TOOL_RESULT_TAIL_CHARS,
		);
	}

	if (!Array.isArray(content)) return content;

	let truncated = 0;
	const newContent = content.map((block) => {
		if (!block || typeof block !== "object") return block;

		if (block.type === "text" && typeof block.text === "string") {
			const text = block.text as string;
			if (text.length <= TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS + 50) {
				return block;
			}
			truncated++;
			return {
				...block,
				text: truncateString(
					text,
					TOOL_RESULT_HEAD_CHARS,
					TOOL_RESULT_TAIL_CHARS,
				),
			};
		}

		if (block.type === "image" || block.type === "document") {
			truncated++;
			return { type: "text", text: `[${block.type} removed by hard compact]` };
		}

		return block;
	});

	return truncated > 0 ? newContent : content;
}

export function truncateAssistantText(text: string): string {
	const estimatedTokens = estimateTokensFromChars(text.length);
	if (estimatedTokens <= ASSISTANT_TEXT_TRUNCATE_THRESHOLD_TOKENS) return text;
	const maxChars = ASSISTANT_TEXT_MAX_TOKENS * CHARS_PER_TOKEN_ESTIMATE;
	const head = text.slice(0, maxChars * 2);
	const tail = text.slice(-200);
	const removed = text.length - head.length - tail.length;
	return `${head}\n[truncated: ~${removed} chars removed]\n${tail}`;
}

export function hardCompactMessages(
	messages: Message[],
	keepRecentRounds: number = DEFAULT_KEEP_RECENT_ROUNDS,
): HardCompactResult {
	const preCompactTokens = roughTokenCountEstimationForMessages(
		messages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
	); // log: cast Message[] for param type

	// P1.2 (audit): 影子价压缩 — 选择性裁剪高价工具结果, 保可复用前缀。
	// default-off (FUSION_CODE_SHADOW_PRICE_COMPACT=1)。off 走下方原 head/tail 路径, byte-identical。
	if (isShadowPriceCompactEnabled()) {
		const sp = shadowPriceCompactMessages(messages, keepRecentRounds);
		return {
			messages: sp.messages,
			truncatedToolResults: sp.truncatedToolResults,
			truncatedAssistantTexts: sp.truncatedAssistantTexts,
			roundsKeptIntact: sp.roundsKeptIntact,
			roundsProcessed: sp.roundsProcessed,
			preCompactTokens: sp.preCompactTokens,
			postCompactTokens: sp.postCompactTokens,
			candidates: sp.candidates,
			priceThreshold: sp.priceThreshold,
		};
	}

	let truncatedToolResults = 0;
	let truncatedAssistantTexts = 0;

	const groups = groupMessagesByApiRound(messages);
	const roundsKeptIntact = Math.min(keepRecentRounds, groups.length);
	const roundsToProcess = groups.length - roundsKeptIntact;

	if (roundsToProcess <= 0) {
		logForDebugging(
			`[HardCompact] All ${groups.length} rounds within keep range, nothing to compact`,
		);
		return {
			messages,
			truncatedToolResults: 0,
			truncatedAssistantTexts: 0,
			roundsKeptIntact: groups.length,
			roundsProcessed: 0,
			preCompactTokens,
			postCompactTokens: preCompactTokens,
		};
	}

	const result: Message[] = [];

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
						if (block.type === "tool_result") {
							const originalContent = block.content as
								| string
								| Array<Record<string, unknown>>
								| undefined;
							if (originalContent !== undefined) {
								const truncated = truncateToolResultContent(originalContent);
								if (truncated !== originalContent) {
									didTruncate = true;
									truncatedToolResults++;
									return { ...block, content: truncated };
								}
							}
						}
						return block;
					});
					if (didTruncate) {
						result.push({
							...userMsg,
							message: {
								...userMsg.message,
								content: newContent as typeof userMsg.message.content,
							}, // log: cast ContentBlockParam[]
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
								// log: intermediate as unknown
								const textBlock = block as { type: "text"; text: string };
								if (textBlock.text === textContent) {
									return { ...textBlock, text: truncatedText };
								}
							}
							return block;
						});
						result.push({
							...asstMsg,
							message: {
								...asstMsg.message,
								content: newContent as typeof asstMsg.message.content,
							}, // log: cast BetaContentBlock[]
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

	const postCompactTokens = roughTokenCountEstimationForMessages(
		result as Parameters<typeof roughTokenCountEstimationForMessages>[0],
	); // log: cast Message[]
	logForDebugging(
		`[HardCompact] Processed ${roundsToProcess}/${groups.length} rounds, ` +
			`truncated ${truncatedToolResults} tool_results, ${truncatedAssistantTexts} assistant texts, ` +
			`tokens ${preCompactTokens} → ${postCompactTokens}`,
	);

	return {
		messages: result,
		truncatedToolResults,
		truncatedAssistantTexts,
		roundsKeptIntact,
		roundsProcessed: roundsToProcess,
		preCompactTokens,
		postCompactTokens,
	};
}

export function shouldUseHardCompact(): boolean {
	return isFusionMlxProvider();
}

export function getHardCompactTokenBudget(): number {
	const model = getMainLoopModel();
	const contextWindow = getContextWindowForModel(model);
	return Math.floor(contextWindow * 0.6);
}
