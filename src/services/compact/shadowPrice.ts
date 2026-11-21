// P1.2 (audit): shadow-price compaction — cost model for tool results +
// selective pruning.
// Shadow price = token size (bigger = more worth pruning) + reference
// frequency (fewer references = more worth pruning) + recency (older = more
// worth pruning).
// Naive head/tail truncation becomes selective pruning: high-price results
// get truncated, low-price results stay intact -> longer reusable prefix
// boundary.
// Together with #2 this directly serves MLX KV-cache reuse (compress the
// suffix, keep the prefix).
//
// default-off (FUSION_CODE_SHADOW_PRICE_COMPACT=1). Off = hardCompact takes
// the original head/tail path, byte-identical.
// Pure function (no side effects, no IO), unit-testable.

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

// Switch. Off = caller takes the original head/tail path (byte-identical).
export function isShadowPriceCompactEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_SHADOW_PRICE_COMPACT);
}

// Shadow-price weights — size dominates (saving tokens is the primary
// goal), frequency/recency secondary.
const WEIGHT_SIZE = 0.6;
const WEIGHT_FREQ = 0.2;
const WEIGHT_RECENCY = 0.2;

// Shadow-price score. Higher = more worth pruning (saves more space, fewer
// references, older).
// sizeTokens: token estimate for this result; refCount: number of references
// from later assistant messages;
// roundIndex: index of the containing round; totalRounds: total rounds;
// recentBoost: recent-round weight.
export interface ShadowPriceInputs {
	sizeTokens: number;
	refCount: number;
	roundIndex: number;
	totalRounds: number;
}

export function computeShadowPrice(inputs: ShadowPriceInputs): number {
	const { sizeTokens, refCount, roundIndex, totalRounds } = inputs;
	// size component: normalized (assumes a per-result cap of ~32K tokens,
	// /1000 maps to a 0..~32 range).
	const sizeScore = Math.min(sizeTokens / 1000, 32);
	// freq component: more references = more preserved (cost drops). Zero
	// references = 1.0 full cost; 10+ references ≈ 0.
	const freqScore = 1 / (1 + refCount);
	// recency component: smaller round index = older -> more worth pruning.
	// Normalized to [0,1].
	const recencyScore =
		totalRounds <= 1 ? 1 : 1 - roundIndex / (totalRounds - 1);
	const price =
		WEIGHT_SIZE * sizeScore +
		WEIGHT_FREQ * freqScore +
		WEIGHT_RECENCY * recencyScore;
	return price;
}

// Tool-result token estimate (chars / 4).
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

// Candidate: one prunable tool result + its shadow price.
export interface PruneCandidate {
	roundIndex: number;
	messageIndex: number;
	toolUseId: string | undefined;
	shadowPrice: number;
	sizeTokens: number;
}

// Scan messages, compute the shadow price for every tool result in old
// rounds, return the candidate list (descending).
// The most recent keepRecentRounds rounds are never pruned (consistent with
// the original hardCompact).
export function collectShadowPriceCandidates(
	messages: Message[],
	keepRecentRounds: number,
): PruneCandidate[] {
	const groups = groupMessagesByApiRound(messages);
	const totalRounds = groups.length;
	const roundsKeptIntact = Math.min(keepRecentRounds, totalRounds);
	const roundsToProcess = totalRounds - roundsKeptIntact;
	if (roundsToProcess <= 0) return [];

	// First seed the reference table (all tool_use_id start at 0), then scan
	// assistant text to accumulate counts.
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
	// Descending: high price pruned first.
	candidates.sort((a, b) => b.shadowPrice - a.shadowPrice);
	return candidates;
}

// Shadow-price pruning result.
export interface ShadowPriceCompactResult {
	messages: Message[];
	truncatedToolResults: number;
	truncatedAssistantTexts: number;
	roundsKeptIntact: number;
	roundsProcessed: number;
	preCompactTokens: number;
	postCompactTokens: number;
	prunedCandidateCount: number;
	// insight-0902 E3: candidate score table (descending), for /diff-compaction audit display.
	candidates: PruneCandidate[];
	priceThreshold: number;
}

// Selective shadow-price pruning. Only high-price tool results (above the
// threshold) get pruned; low-price ones stay intact -> longer reusable prefix.
// Assistant text follows the original hardCompact strategy (truncate above
// threshold).
// keepRecentRounds: number of recent rounds to keep; priceThreshold: prune
// only above this price (default 2.0).
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
			prunedCandidateCount: 0,
			candidates: [],
			priceThreshold,
		};
	}

	const candidates = collectShadowPriceCandidates(messages, keepRecentRounds);
	// High-price set (to prune): toolUseId -> price.
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
						// Only high-price candidates get pruned; low-price ones stay intact.
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

	// No mutation -> return the original array reference (no-op contract:
	// callers can safely compare with ===).
	// With mutation -> return a new array. Selective pruning preserves the
	// untouched prefix -> longer reusable prefix.
	// P2-2 (audit 0901): drop the prefixBoundaryIndex field — no downstream
	// cache_control breakpoint consumer exists (hardCompact/QueryEngine don't
	// set cache_control by index), so it was dropped.
	// Deleting the field (YAGNI, Rule 2) avoids confusion. The reusable prefix
	// is guaranteed by selective pruning itself, not by an explicit marker.
	const finalMessages = firstMutatedIndex === -1 ? messages : result;
	const postCompactTokens = roughTokenCountEstimationForMessages(
		finalMessages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
	);
	logForDebugging(
		`[ShadowPrice] Processed ${roundsToProcess}/${totalRounds} rounds, ` +
			`pruned ${truncatedToolResults} tool_results (candidates=${prunedCandidateCount}), ` +
			`truncated ${truncatedAssistantTexts} assistant texts, ` +
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
		prunedCandidateCount,
		candidates,
		priceThreshold,
	};
}

// Re-export hardCompact constant entry point (avoids duplicate definitions;
// change one place when hardCompact changes).
export { TOOL_RESULT_HEAD_CHARS, TOOL_RESULT_TAIL_CHARS, truncateString };
