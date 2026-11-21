import { feature } from "bun:bundle";
import type { UUID } from "node:crypto";
import uniqBy from "lodash-es/uniqBy.js";

/* eslint-disable @typescript-eslint/no-require-imports */
const sessionTranscriptModule = feature("KAIROS")
	? (() => {
			try {
				return require("../sessionTranscript/sessionTranscript.js") as {
					writeSessionTranscriptSegment: (messages: Message[]) => void;
				};
			} catch {
				return null;
			}
		})()
	: null;

import { markPostCompaction } from "src/bootstrap/state.js";
import { getInvokedSkillsForAgent } from "../../bootstrap/state.js";
import type { QuerySource } from "../../constants/querySource.js";
import type { CanUseToolFn } from "../../hooks/useCanUseTool.js";
import type { Tool, ToolUseContext } from "../../Tool.js";
import type { LocalAgentTaskState } from "../../tasks/LocalAgentTask/LocalAgentTask.js";
import { FileReadTool } from "../../tools/FileReadTool/FileReadTool.js";
import {
	FILE_READ_TOOL_NAME,
	FILE_UNCHANGED_STUB,
} from "../../tools/FileReadTool/prompt.js";
import { ToolSearchTool } from "../../tools/ToolSearchTool/ToolSearchTool.js";
import type { AgentId } from "../../types/ids.js";
import type {
	AssistantMessage,
	AttachmentMessage,
	HookResultMessage,
	Message,
	PartialCompactDirection,
	StreamEvent,
	SystemAPIErrorMessage,
	SystemCompactBoundaryMessage,
	SystemMessage,
	UserMessage,
} from "../../types/message.js";
import {
	createAttachmentMessage,
	generateFileAttachment,
	getAgentListingDeltaAttachment,
	getDeferredToolsDeltaAttachment,
	getMcpInstructionsDeltaAttachment,
} from "../../utils/attachments.js";
import { getMemoryPath } from "../../utils/config.js";
import {
	COMPACT_MAX_OUTPUT_TOKENS,
	getContextWindowForModel,
} from "../../utils/context.js";
import {
	analyzeContext,
	tokenStatsToStatsigMetrics,
} from "../../utils/contextAnalysis.js";
import { logForDebugging } from "../../utils/debug.js";
import { hasExactErrorMessage } from "../../utils/errors.js";
import { cacheToObject } from "../../utils/fileStateCache.js";
import {
	type CacheSafeParams,
	runForkedAgent,
} from "../../utils/forkedAgent.js";
import {
	executePostCompactHooks,
	executePreCompactHooks,
} from "../../utils/hooks.js";
import { logError } from "../../utils/log.js";
import { MEMORY_TYPE_VALUES } from "../../utils/memory/types.js";
import {
	createCompactBoundaryMessage,
	createUserMessage,
	getAssistantMessageText,
	getLastAssistantMessage,
	getMessagesAfterCompactBoundary,
	isCompactBoundaryMessage,
	normalizeMessagesForAPI,
} from "../../utils/messages.js";
import { getMainLoopModel } from "../../utils/model/model.js";
import { isFusionMlxProvider } from "../../utils/model/providers.js";
import { expandPath } from "../../utils/path.js";
import { getPlan, getPlanFilePath } from "../../utils/plans.js";
import {
	isSessionActivityTrackingActive,
	sendSessionActivitySignal,
} from "../../utils/sessionActivity.js";
import { processSessionStartHooks } from "../../utils/sessionStart.js";
import {
	getTranscriptPath,
	reAppendSessionMetadata,
} from "../../utils/sessionStorage.js";
import { sleep } from "../../utils/sleep.js";
import { jsonStringify } from "../../utils/slowOperations.js";
/* eslint-enable @typescript-eslint/no-require-imports */
import {
	asSystemPrompt,
	type SystemPrompt,
} from "../../utils/systemPromptType.js";
import { getTaskOutputPath } from "../../utils/task/diskOutput.js";
import {
	getTokenUsage,
	tokenCountFromLastAPIResponse,
	tokenCountWithEstimation,
} from "../../utils/tokens.js";
import {
	extractDiscoveredToolNames,
	isToolSearchEnabled,
} from "../../utils/toolSearch.js";
import { getFeatureValue_CACHED_MAY_BE_STALE } from "../analytics/growthbook.js";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	logEvent,
} from "../analytics/index.js";
import {
	getMaxOutputTokensForModel,
	queryModelWithStreaming,
} from "../api/claude.js";
import {
	getPromptTooLongTokenGap,
	PROMPT_TOO_LONG_ERROR_MESSAGE,
	startsWithApiErrorPrefix,
} from "../api/errors.js";
import { requestMlxGC } from "../api/fusion-mlx-adapter.js";
import { notifyCompaction } from "../api/promptCacheBreakDetection.js";
import { getRetryDelay } from "../api/withRetry.js";
import { logPermissionContextForAnts } from "../internalLogging.js";
import {
	roughTokenCountEstimation,
	roughTokenCountEstimationForMessages,
} from "../tokenEstimation.js";
import { groupMessagesByApiRound } from "./grouping.js";
import {
	getHardCompactTokenBudget,
	hardCompactMessages,
	shouldUseHardCompact,
} from "./hardCompact.js";
import { recordCompactionSnapshot } from "./lastCompactionSnapshot.js";
import {
	getCompactPrompt,
	getCompactUserSummaryMessage,
	getPartialCompactPrompt,
} from "./prompt.js";

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
export const POST_COMPACT_TOKEN_BUDGET = 50_000;
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
// Skills can be large (verify=18.7KB, claude-api=20.1KB). Previously re-injected
// unbounded on every compact → 5-10K tok/compact. Per-skill truncation beats
// dropping — instructions at the top of a skill file are usually the critical
// part. Budget sized to hold ~5 skills at the per-skill cap.
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;
const MAX_COMPACT_STREAMING_RETRIES = 2;

/**
 * Strip image blocks from user messages before sending for compaction.
 * Images are not needed for generating a conversation summary and can
 * cause the compaction API call itself to hit the prompt-too-long limit,
 * especially in CCD sessions where users frequently attach images.
 * Replaces image blocks with a text marker so the summary still notes
 * that an image was shared.
 *
 * Note: Only user messages contain images (either directly attached or within
 * tool_result content from tools). Assistant messages contain text, tool_use,
 * and thinking blocks but not images.
 */
/**
 * Whether any user message carries an image/document block (top-level or
 * nested in tool_result). Mirrors what stripImagesFromMessages would replace.
 */
export function messagesContainMediaBlocks(messages: Message[]): boolean {
	return messages.some((message) => {
		if (message.type !== "user") return false;
		const content = message.message.content;
		if (!Array.isArray(content)) return false;
		return content.some((block) => {
			if (block.type === "image" || block.type === "document") return true;
			if (
				block.type === "tool_result" &&
				Array.isArray(block.content) &&
				block.content.some(
					(item) => item.type === "image" || item.type === "document",
				)
			) {
				return true;
			}
			return false;
		});
	});
}

export function stripImagesFromMessages(messages: Message[]): Message[] {
	return messages.map((message) => {
		if (message.type !== "user") {
			return message;
		}

		const content = message.message.content;
		if (!Array.isArray(content)) {
			return message;
		}

		let hasMediaBlock = false;
		const newContent = content.flatMap((block) => {
			if (block.type === "image") {
				hasMediaBlock = true;
				return [{ type: "text" as const, text: "[image]" }];
			}
			if (block.type === "document") {
				hasMediaBlock = true;
				return [{ type: "text" as const, text: "[document]" }];
			}
			// Also strip images/documents nested inside tool_result content arrays
			if (block.type === "tool_result" && Array.isArray(block.content)) {
				let toolHasMedia = false;
				const newToolContent = block.content.map((item) => {
					if (item.type === "image") {
						toolHasMedia = true;
						return { type: "text" as const, text: "[image]" };
					}
					if (item.type === "document") {
						toolHasMedia = true;
						return { type: "text" as const, text: "[document]" };
					}
					return item;
				});
				if (toolHasMedia) {
					hasMediaBlock = true;
					return [{ ...block, content: newToolContent }];
				}
			}
			return [block];
		});

		if (!hasMediaBlock) {
			return message;
		}

		return {
			...message,
			message: {
				...message.message,
				content: newContent,
			},
		} as typeof message;
	});
}

/**
 * Strip attachment types that are re-injected post-compaction anyway.
 * skill_discovery/skill_listing are re-surfaced by resetSentSkillNames()
 * + the next turn's discovery signal, so feeding them to the summarizer
 * wastes tokens and pollutes the summary with stale skill suggestions.
 *
 * No-op when EXPERIMENTAL_SKILL_SEARCH is off (the attachment types
 * don't exist on external builds).
 */
export function stripReinjectedAttachments(messages: Message[]): Message[] {
	if (feature("EXPERIMENTAL_SKILL_SEARCH")) {
		return messages.filter(
			(m) =>
				!(
					m.type === "attachment" &&
					(m.attachment.type === "skill_discovery" ||
						m.attachment.type === "skill_listing")
				),
		);
	}
	return messages;
}

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
	"Not enough messages to compact.";
const MAX_PTL_RETRIES = 3;
const PTL_RETRY_MARKER =
	"[earlier conversation truncated for compaction retry]";
// item 16 (CC 2.1.228): compact stall notice. An LLM-summary compact stream can go 30s+ with no tokens
// (MLX summarization of large contexts is slow), and the user cannot distinguish "normally slow" from
// "stuck and retrying". Periodically emit compact_stall {elapsedMs} so the frontend can show an
// elapsed-time hint. Granularity 10s (coarse hint, not a precise progress bar).
const COMPACT_STALL_INTERVAL_MS = 10_000;

// Start the compact stall timer: emit compact_stall every COMPACT_STALL_INTERVAL_MS.
// Returns a clear fn; the caller clears it in the finally of the compact_end/throw path (leak prevention).
// Does not reuse REPL's loadingStartTimeRef (it points at the query start, not the compact start, so elapsed is inaccurate).
export function startCompactStallTimer(
	context: ToolUseContext,
	startTime: number,
	intervalMs: number = COMPACT_STALL_INTERVAL_MS,
): () => void {
	if (!context.onCompactProgress) return () => {};
	const interval = setInterval(() => {
		context.onCompactProgress?.({
			type: "compact_stall",
			elapsedMs: Date.now() - startTime,
		});
	}, intervalMs);
	return () => clearInterval(interval);
}
// Local-model compact safety factor: use only 70% of the context window as the compact input cap,
// leaving 30% for KV cache overhead (a 32B model's long-context KV cache can take 30%+ of memory)
const MLX_COMPACT_TOKEN_SAFETY_FACTOR = 0.7;

// Cloud/gateway-model compact output-token safety margin. Reserved from contextWindow - input
// for the system prompt + tool defs + the summarization request's own overhead,
// avoiding a 400 caused by input + maxOutputTokens exactly filling the window.
const COMPACT_OUTPUT_SAFETY_MARGIN = 4_096;
// Compact output-token floor: even when input is near the window cap, keep this much output so the
// model can generate a meaningful summary rather than max_tokens=0 or a single digit that cannot form text.
const COMPACT_OUTPUT_TOKEN_FLOOR = 2_048;

/**
 * Compute the maxOutputTokens cap for the current compact request.
 * MLX already truncates input via preflightMlxTokenTruncate; this only covers cloud/gateway:
 * when input + the default output budget > contextWindow, squeeze the output budget down to
 * contextWindow - input - the safety margin, keeping at least COMPACT_OUTPUT_TOKEN_FLOOR.
 * Returns undefined when no rewrite is needed (use the existing fixed value/model default), staying byte-identical.
 *
 * @param model - mainLoopModel (used to look up the context window + default output budget)
 * @param estimatedInputTokens - estimated token count of the messages to be summarized
 */
export function getCompactOutputTokenCap(
	model: string,
	estimatedInputTokens: number,
): number | undefined {
	// MLX goes through preflightMlxTokenTruncate; not handled here
	if (isFusionMlxProvider()) return undefined;
	const contextWindow = getContextWindowForModel(model);
	if (!contextWindow || contextWindow <= 0) return undefined;
	const modelDefaultOutput = getMaxOutputTokensForModel(model);
	// Candidate output budget: the smaller of COMPACT_MAX_OUTPUT_TOKENS and the model default
	const candidate = Math.min(COMPACT_MAX_OUTPUT_TOKENS, modelDefaultOutput);
	// Only compress when input + candidate would touch/exceed the window; otherwise keep the status quo (byte-identical)
	// Uses < (not <=): exact equality also counts as full; squeeze the output to keep a safety margin, avoiding input+output exactly filling the window.
	if (estimatedInputTokens + candidate < contextWindow) return undefined;
	const capped =
		contextWindow - estimatedInputTokens - COMPACT_OUTPUT_SAFETY_MARGIN;
	const safeCap = Math.max(COMPACT_OUTPUT_TOKEN_FLOOR, capped);
	logForDebugging(
		`[Compact] context-aware output cap: input=${estimatedInputTokens} ctx=${contextWindow} candidate=${candidate} → capped=${safeCap}`,
		{ level: "warn" },
	);
	return safeCap;
}

/**
 * Detect litellm/gateway context-window-exceeded errors (ContextWindowExceededError).
 * Cloud gateways (e.g. litellm + glm5.2) return 400 when input + max_tokens exceeds the model's
 * context window; the error body contains "ContextWindowExceeded" / "maximum context length of" /
 * "input tokens" + "output tokens" + "> <max>". Such errors are semantically equivalent to
 * prompt-too-long: truncate the input and retry rather than throwing and stalling the user.
 */
export function isContextWindowExceededError(summary: string | null): boolean {
	if (!summary) return false;
	return (
		summary.includes("ContextWindowExceeded") ||
		(summary.includes("maximum context length of") &&
			summary.includes("input tokens") &&
			summary.includes("output tokens"))
	);
}

/**
 * Drops the oldest API-round groups from messages until tokenGap is covered.
 * Falls back to dropping 20% of groups when the gap is unparseable (some
 * Vertex/Bedrock error formats). Returns null when nothing can be dropped
 * without leaving an empty summarize set.
 *
 * This is the last-resort escape hatch for CC-1180 — when the compact request
 * itself hits prompt-too-long, the user is otherwise stuck. Dropping the
 * oldest context is lossy but unblocks them. The reactive-compact path
 * (compactMessages.ts) has the proper retry loop that peels from the tail;
 * this helper is the dumb-but-safe fallback for the proactive/manual path
 * that wasn't migrated in bfdb472f's unification.
 */
export function truncateHeadForPTLRetry(
	messages: Message[],
	ptlResponse: AssistantMessage,
): Message[] | null {
	// Strip our own synthetic marker from a previous retry before grouping.
	// Otherwise it becomes its own group 0 and the 20% fallback stalls
	// (drops only the marker, re-adds it, zero progress on retry 2+).
	const input =
		messages[0]?.type === "user" &&
		messages[0].isMeta &&
		messages[0].message.content === PTL_RETRY_MARKER
			? messages.slice(1)
			: messages;

	const groups = groupMessagesByApiRound(input);
	if (groups.length < 2) return null;

	const tokenGap = getPromptTooLongTokenGap(ptlResponse);
	let dropCount: number;
	if (tokenGap !== undefined) {
		let acc = 0;
		dropCount = 0;
		for (const g of groups) {
			acc += roughTokenCountEstimationForMessages(
				g as readonly {
					type: string;
					message?: { content?: unknown };
					attachment?: import("../../utils/attachments.js").Attachment;
				}[],
			);
			dropCount++;
			if (acc >= tokenGap) break;
		}
	} else {
		dropCount = Math.max(1, Math.floor(groups.length * 0.2));
	}

	// Keep at least one group so there's something to summarize.
	dropCount = Math.min(dropCount, groups.length - 1);
	if (dropCount < 1) return null;

	const sliced = groups.slice(dropCount).flat();
	// groupMessagesByApiRound puts the preamble in group 0 and starts every
	// subsequent group with an assistant message. Dropping group 0 leaves an
	// assistant-first sequence which the API rejects (first message must be
	// role=user). Prepend a synthetic user marker — ensureToolResultPairing
	// already handles any orphaned tool_results this creates.
	if (sliced[0]?.type === "assistant") {
		return [
			createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),
			...sliced,
		];
	}
	return sliced;
}

type TruncateRetryLogExtra = Record<
	string,
	AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | number | boolean
>;

type CompactSummaryRetryOptions = {
	messages: Message[];
	summaryRequest: UserMessage;
	appState: Awaited<ReturnType<ToolUseContext["getAppState"]>>;
	context: ToolUseContext;
	preCompactTokenCount: number;
	cacheSafeParams: CacheSafeParams;
	// Debug-log prefix distinguishing full vs partial compact ("[Compact]" / "[Partial Compact]")
	logPrefix: string;
	// Caller-owned failure event (the two paths log different event names/fields)
	logFailed: (
		ptlAttempts: number,
		// audit v3-0913 P2-2: the failure event also carries the actual sent round count (incl. PTL truncation)
		finalMessageCount: number,
		// audit v3 P3: the real failure reason (prompt_too_long/mlx_memory/mlx_server_error/
		// context_window_exceeded) — the caller previously hardcoded prompt_too_long,
		// inconsistent with the throw-message branch decision
		failReason:
			| "prompt_too_long"
			| "mlx_memory"
			| "mlx_server_error"
			| "context_window_exceeded",
	) => void;
	// Extra fields appended to fusion_compact_ptl_retry (e.g. path: "partial")
	retryLogExtra?: TruncateRetryLogExtra;
	// Test seam (DI): the production implementation by default; assertion cases inject a controlled stub to simulate PTL retry rounds.
	streamFn?: typeof streamCompactSummary;
};

/**
 * Shared compact-summary request loop with PTL/MLX-OOM/context-window
 * truncate-retry (CC-1180 + item 16). Previously duplicated ~90 lines across
 * compactConversation and partialCompactConversation with only event names,
 * log prefixes, and forkContextMessages initialization differing — now those
 * differences are injected via opts, keeping the retry semantics identical:
 *
 * - prompt-too-long / MLX empty-OOM / MLX 5xx / context-window-overflow all
 *   trigger head-truncation retry (up to MAX_PTL_RETRIES), emitting
 *   compact_retry progress each attempt.
 * - When nothing more can be truncated, logs the caller-owned failure event
 *   and throws the matching user-facing error.
 * - The forked-agent path reads forkContextMessages (not `messages`), so each
 *   truncation is threaded through cacheSafeParams as well.
 */
export async function runCompactSummaryWithTruncateRetry(
	opts: CompactSummaryRetryOptions,
): Promise<{
	summaryResponse: AssistantMessage;
	summary: string | null;
	// audit v3-0913 P1 fix: the actual number of rounds sent after truncate-retries (= opts.messages.length when untruncated).
	// The caller's local variable is no longer written back by the loop (the write-back is enclosed in this function);
	// metadata stats (summarizeMetadata.messagesSummarized) must use this value to reflect the true figure.
	finalMessageCount: number;
}> {
	const streamSummary = opts.streamFn ?? streamCompactSummary;
	const {
		messages,
		summaryRequest,
		appState,
		context,
		preCompactTokenCount,
		cacheSafeParams,
		logPrefix,
		logFailed,
		retryLogExtra,
	} = opts;
	let currentMessages = messages;
	let currentParams = cacheSafeParams;
	let ptlAttempts = 0;
	for (;;) {
		const summaryResponse = await streamSummary({
			messages: currentMessages,
			summaryRequest,
			appState,
			context,
			preCompactTokenCount,
			cacheSafeParams: currentParams,
		});
		const summary = getAssistantMessageText(summaryResponse);
		// On fusion-mlx memory exhaustion the engine returns a 200 + empty content stream (prefill-stage
		// abort, no error event); the summary is empty with no error text -> the upper layer throws
		// "no valid text content". An MLX empty response is almost always memory exhaustion; reuse the
		// prompt-too-long truncate-retry: drop the oldest API rounds one by one until prefill fits the
		// memory cap, letting /compact succeed even on very large conversations; throw an explicit
		// memory-cap error once nothing more can be truncated.
		const isEmptyMlxOom = !summary && isFusionMlxProvider();
		// A fusion-mlx engine routing bug (AttributeError) or OOM (RuntimeError) returns a 500 error;
		// the MLX adapter turns it into "Fusion-MLX API error: 500 ..." or a mid-stream error,
		// and the compact streaming path returns it as the API Error summary. Detecting such errors
		// also triggers the truncate-retry.
		// (Does not match generic Python exception names, to avoid false positives on legitimate Python debugging summaries)
		const isMlxServerError =
			isFusionMlxProvider() &&
			summary &&
			(summary.includes("process memory limit exceeded") ||
				summary.includes("Fusion-MLX API error: 5"));
		// Cloud/gateway (litellm/gateway) context-window overflow: input + max_tokens over the window →
		// 400 ContextWindowExceededError. Semantically the same as prompt-too-long; truncate the input and retry.
		const isContextWindowOverflow = isContextWindowExceededError(summary);
		const needsTruncateRetry =
			summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE) ||
			isEmptyMlxOom ||
			isMlxServerError ||
			isContextWindowOverflow;
		if (isEmptyMlxOom) {
			logForDebugging(
				`${logPrefix} empty response (suspected fusion-mlx memory exhaustion), triggering truncate-retry`,
				{ level: "warn" },
			);
		}
		if (isMlxServerError) {
			logForDebugging(
				`${logPrefix} MLX server-side error, triggering truncate-retry: ${summary?.slice(0, 200)}`,
				{ level: "warn" },
			);
		}
		if (isContextWindowOverflow) {
			logForDebugging(
				`${logPrefix} cloud-gateway context window exceeded, triggering truncate-retry: ${summary?.slice(0, 200)}`,
				{ level: "warn" },
			);
		}
		if (!needsTruncateRetry) {
			return {
				summaryResponse,
				summary,
				finalMessageCount: currentMessages.length,
			};
		}

		// CC-1180: compact request itself hit prompt-too-long. Truncate the
		// oldest API-round groups and retry rather than leaving the user stuck.
		ptlAttempts++;
		// item 16 (CC 2.1.228): emit user-visible retry progress (reuses the already-computed decision, no re-evaluation)
		// audit v3 P3: extracted into a local variable; logFailed reuses the same decision (the caller previously hardcoded it)
		const retryReason:
			| "prompt_too_long"
			| "mlx_memory"
			| "mlx_server_error"
			| "context_window_exceeded" = isEmptyMlxOom
			? "mlx_memory"
			: isMlxServerError
				? "mlx_server_error"
				: isContextWindowOverflow
					? "context_window_exceeded"
					: "prompt_too_long";
		context.onCompactProgress?.({
			type: "compact_retry",
			attempt: ptlAttempts,
			maxRetries: MAX_PTL_RETRIES,
			reason: retryReason,
		});
		const truncated =
			ptlAttempts <= MAX_PTL_RETRIES
				? truncateHeadForPTLRetry(currentMessages, summaryResponse)
				: null;
		if (!truncated) {
			logFailed(ptlAttempts, currentMessages.length, retryReason);
			throw new Error(
				isEmptyMlxOom || isMlxServerError
					? ERROR_MESSAGE_MLX_MEMORY_LIMIT
					: isContextWindowOverflow
						? "Context window exceeded after truncation retries"
						: ERROR_MESSAGE_PROMPT_TOO_LONG,
			);
		}
		logEvent("fusion_compact_ptl_retry", {
			attempt: ptlAttempts,
			droppedMessages: currentMessages.length - truncated.length,
			remainingMessages: truncated.length,
			...retryLogExtra,
		});
		currentMessages = truncated;
		// The forked-agent path reads from cacheSafeParams.forkContextMessages,
		// not the messages param — thread the truncated set through both paths.
		currentParams = {
			...currentParams,
			forkContextMessages: truncated,
		};
	}
}

/**
 * Pre-flight token budget check for local MLX models.
 * Compact sends the ENTIRE conversation to the model for summarization.
 * With large models (32B+) and long conversations, the KV cache can push
 * fusion-mlx past its memory ceiling, causing OOM or process crash.
 * This function proactively truncates messages to fit within a safe
 * token budget BEFORE sending to the model, preventing the cascade:
 *   OOM → empty response → retry loop → more OOM → system crash
 * Returns truncated messages, or null if no truncation needed.
 */
export function preflightMlxTokenTruncate(
	messages: Message[],
	systemPrompt?: SystemPrompt,
	toolUseContext?: ToolUseContext,
): Message[] | null {
	if (!isFusionMlxProvider()) {
		logForDebugging(`[Compact] MLX pre-flight skip: not MLX provider`);
		return null;
	}

	const model = getMainLoopModel();
	if (!model) {
		logForDebugging(`[Compact] MLX pre-flight skip: no model`, {
			level: "warn",
		});
		return null;
	}

	const contextWindow = getContextWindowForModel(model);
	if (!contextWindow || contextWindow <= 0) {
		logForDebugging(
			`[Compact] MLX pre-flight skip: no context window for ${model}`,
			{ level: "warn" },
		);
		return null;
	}

	// Output tokens also occupy the context window; they must be deducted from the input budget
	const safeBudget = Math.floor(
		(contextWindow - COMPACT_MAX_OUTPUT_TOKENS) *
			MLX_COMPACT_TOKEN_SAFETY_FACTOR,
	);
	// Compact sends system_prompt + tool_defs + messages to the model.
	// safeBudget is for the TOTAL input, so the message-only budget must
	// subtract system prompt and tool definition tokens. Without this,
	// truncating messages to safeBudget leaves no room for system+tools,
	// and the compact call itself OOMs on 32K windows.
	const systemStr = systemPrompt ? systemPrompt.join("\n") : "";
	// Single estimation source (audit v2-0912 P2): use roughTokenCountEstimation
	// (4 chars/token) instead of an ad-hoc /3.5 divisor — same heuristic as
	// tokenCountWithEstimation below, so budget math uses one consistent ratio.
	const estimatedSystemTokens = roughTokenCountEstimation(systemStr);
	const toolDefs = toolUseContext?.options?.tools;
	const estimatedToolTokens = toolDefs
		? roughTokenCountEstimation(
				JSON.stringify(
					toolDefs.map((t) => ({
						name: t.name,
						description:
							(t as unknown as { description?: string }).description ?? "",
					})),
				),
			)
		: 0;
	const messageBudget =
		safeBudget - estimatedSystemTokens - estimatedToolTokens;
	const estimated = tokenCountWithEstimation(messages);

	if (messageBudget <= 0) {
		logForDebugging(
			`[Compact] MLX pre-flight: message budget <= 0 (safe=${safeBudget} sys=${estimatedSystemTokens} tools=${estimatedToolTokens}), cannot compact safely`,
			{ level: "warn" },
		);
		return null;
	}

	if (estimated <= messageBudget) {
		logForDebugging(
			`[Compact] MLX pre-flight OK: ${estimated} tokens <= message budget ${messageBudget} (safe=${safeBudget} sys=${estimatedSystemTokens} tools=${estimatedToolTokens})`,
		);
		return null;
	}

	logForDebugging(
		`[Compact] MLX pre-flight OVER: ${estimated} tokens > message budget ${messageBudget} (safe=${safeBudget} sys=${estimatedSystemTokens} tools=${estimatedToolTokens}), truncating`,
		{ level: "warn" },
	);

	// Drop API rounds from oldest to newest until the input fits the safe budget
	const groups = groupMessagesByApiRound(messages);
	if (groups.length < 2) {
		logForDebugging(
			`[Compact] MLX pre-flight: only 1 group, cannot truncate safely`,
			{ level: "warn" },
		);
		return null;
	}

	let dropCount = 0;
	let remaining = estimated;
	for (const g of groups) {
		remaining -= roughTokenCountEstimationForMessages(
			g as readonly {
				type: string;
				message?: { content?: unknown };
				attachment?: import("../../utils/attachments.js").Attachment;
			}[],
		);
		dropCount++;
		if (remaining <= messageBudget) break;
	}

	// Keep at least 1 group
	dropCount = Math.min(dropCount, groups.length - 1);
	if (dropCount < 1) return null;

	const sliced = groups.slice(dropCount).flat();
	if (sliced[0]?.type === "assistant") {
		return [
			createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),
			...sliced,
		];
	}

	logForDebugging(
		`[Compact] MLX pre-flight: dropped ${dropCount} groups, ${sliced.length} messages remaining`,
	);
	return sliced;
}

export const ERROR_MESSAGE_PROMPT_TOO_LONG =
	"Conversation too long. Press esc twice to go up a few messages and try again.";
export const ERROR_MESSAGE_USER_ABORT = "API Error: Request was aborted.";
export const ERROR_MESSAGE_MLX_MEMORY_LIMIT =
	"Conversation too large for the local MLX model memory limit. Try /clear, switch to a smaller model, or remove some context before compacting.";
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
	"Compaction interrupted · This may be due to network issues — please try again.";

export interface CompactionResult {
	boundaryMarker: SystemMessage;
	summaryMessages: UserMessage[];
	attachments: AttachmentMessage[];
	hookResults: HookResultMessage[];
	messagesToKeep?: Message[];
	userDisplayMessage?: string;
	preCompactTokenCount?: number;
	postCompactTokenCount?: number;
	truePostCompactTokenCount?: number;
	compactionUsage?: ReturnType<typeof getTokenUsage>;
}

/**
 * Diagnosis context passed from autoCompactIfNeeded into compactConversation.
 * Lets the fusion_compact event disambiguate same-chain loops (H2) from
 * cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins.
 */
export type RecompactionInfo = {
	isRecompactionInChain: boolean;
	turnsSincePreviousCompact: number;
	previousCompactTurnId?: string;
	autoCompactThreshold: number;
	querySource?: QuerySource;
};

/**
 * Build the base post-compact messages array from a CompactionResult.
 * This ensures consistent ordering across all compaction paths.
 * Order: boundaryMarker, summaryMessages, messagesToKeep, attachments, hookResults
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
	return [
		result.boundaryMarker,
		...result.summaryMessages,
		...(result.messagesToKeep ?? []),
		...result.attachments,
		...result.hookResults,
	];
}

/**
 * Annotate a compact boundary with relink metadata for messagesToKeep.
 * Preserved messages keep their original parentUuids on disk (dedup-skipped);
 * the loader uses this to patch head→anchor and anchor's-other-children→tail.
 *
 * `anchorUuid` = what sits immediately before keep[0] in the desired chain:
 *   - suffix-preserving (reactive/session-memory): last summary message
 *   - prefix-preserving (partial compact): the boundary itself
 */
export function annotateBoundaryWithPreservedSegment(
	boundary: SystemCompactBoundaryMessage,
	anchorUuid: UUID,
	messagesToKeep: readonly Message[] | undefined,
): SystemCompactBoundaryMessage {
	const keep = messagesToKeep ?? [];
	if (keep.length === 0) return boundary;
	return {
		...boundary,
		compactMetadata: {
			...boundary.compactMetadata,
			preservedSegment: {
				headUuid: keep[0]?.uuid,
				anchorUuid,
				tailUuid: keep.at(-1)?.uuid,
			},
		},
	};
}

/**
 * Merges user-supplied custom instructions with hook-provided instructions.
 * User instructions come first; hook instructions are appended.
 * Empty strings normalize to undefined.
 */
export function mergeHookInstructions(
	userInstructions: string | undefined,
	hookInstructions: string | undefined,
): string | undefined {
	if (!hookInstructions) return userInstructions || undefined;
	if (!userInstructions) return hookInstructions;
	return `${userInstructions}\n\n${hookInstructions}`;
}

/**
 * Creates a compact version of a conversation by summarizing older messages
 * and preserving recent conversation history.
 */
export async function compactConversation(
	messages: Message[],
	context: ToolUseContext,
	cacheSafeParams: CacheSafeParams,
	suppressFollowUpQuestions: boolean,
	customInstructions?: string,
	isAutoCompact: boolean = false,
	recompactionInfo?: RecompactionInfo,
): Promise<CompactionResult> {
	// item 16: compact stall timer. Declared before try (block-scope: a let inside try is invisible to finally),
	// started at compact_start, cleared in finally. The hook-blocked early-return path is also covered by finally.
	let clearStallTimer: () => void = () => {};
	try {
		if (messages.length === 0) {
			throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES);
		}

		const preCompactTokenCount = tokenCountWithEstimation(messages);

		const appState = context.getAppState();
		void logPermissionContextForAnts(appState.toolPermissionContext, "summary");

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "pre_compact",
		});

		// Execute PreCompact hooks
		context.setSDKStatus?.("compacting");
		const hookResult = await executePreCompactHooks(
			{
				trigger: isAutoCompact ? "auto" : "manual",
				customInstructions: customInstructions ?? null,
			},
			context.abortController.signal,
		);
		if (hookResult.blocked) {
			logForDebugging(
				`Compaction blocked by PreCompact hook: ${hookResult.stopReason}`,
			);
			context.onCompactProgress?.({ type: "compact_end" });
			return {
				boundaryMarker: createCompactBoundaryMessage("auto", 0, undefined),
				summaryMessages: [],
				attachments: [],
				hookResults: [],
				userDisplayMessage: hookResult.userDisplayMessage,
			};
		}
		customInstructions = mergeHookInstructions(
			customInstructions,
			hookResult.newCustomInstructions,
		);
		const userDisplayMessage = hookResult.userDisplayMessage;

		// Show requesting mode with up arrow and custom message
		context.setStreamMode?.("requesting");
		context.setResponseLength?.(() => 0);
		context.onCompactProgress?.({ type: "compact_start" });
		// item 16: start the stall timer after compact_start, cleared in finally
		clearStallTimer = startCompactStallTimer(context, Date.now());

		// 3P default: true — forked-agent path reuses main conversation's prompt cache.
		// Experiment (Jan 2026) confirmed: false path is 98% cache miss, costs ~0.76% of
		// fleet cache_creation (~38B tok/day), concentrated in ephemeral envs (CCR/GHA/SDK)
		// with cold GB cache and 3P providers where GB is disabled. GB gate kept as kill-switch.
		const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
			"fusion_compact_cache_prefix",
			true,
		);

		// Hard compact: on MLX prefer the deterministic truncation path, no LLM call
		// suggest1.md core insight: "having an LLM generate the summary is a logical paradox under the local architecture"
		// by the time compact fires we are already near the context cap; sending the full message set for summarization would only OOM
		if (shouldUseHardCompact()) {
			const hardResult = hardCompactMessages(messages);
			// insight-0902 E3: record the compaction snapshot on the side for /diff-compaction audit (fail-open).
			recordCompactionSnapshot({
				timestamp: Date.now(),
				provider:
					hardResult.candidates !== undefined ? "shadow-price" : "hard-tail",
				candidates: hardResult.candidates ?? [],
				priceThreshold: hardResult.priceThreshold,
				truncatedToolResults: hardResult.truncatedToolResults,
				truncatedAssistantTexts: hardResult.truncatedAssistantTexts,
				roundsKeptIntact: hardResult.roundsKeptIntact,
				roundsProcessed: hardResult.roundsProcessed,
				preCompactTokens: hardResult.preCompactTokens,
				postCompactTokens: hardResult.postCompactTokens,
				prunedCandidateCount:
					hardResult.candidates?.filter(
						(c) =>
							hardResult.priceThreshold !== undefined &&
							c.shadowPrice >= hardResult.priceThreshold,
					).length ?? 0,
			});
			const hardBudget = getHardCompactTokenBudget();
			logEvent("fusion_compact_hard", {
				originalMessageCount: messages.length,
				hardCompactMessageCount: hardResult.messages.length,
				truncatedToolResults: hardResult.truncatedToolResults,
				truncatedAssistantTexts: hardResult.truncatedAssistantTexts,
				roundsKeptIntact: hardResult.roundsKeptIntact,
				roundsProcessed: hardResult.roundsProcessed,
				preCompactTokens: hardResult.preCompactTokens,
				postCompactTokens: hardResult.postCompactTokens,
				withinBudget: hardResult.postCompactTokens <= hardBudget,
			});
			if (hardResult.postCompactTokens <= hardBudget) {
				logForDebugging(
					`[Compact] Hard compact succeeded: ${hardResult.preCompactTokens} → ${hardResult.postCompactTokens} tokens, ` +
						`truncated ${hardResult.truncatedToolResults} tool_results, ${hardResult.truncatedAssistantTexts} assistant texts`,
				);
				// Post-hard-compact GC: release stale KV cache in fusion-mlx backend
				requestMlxGC()
					.then((gcResult) => {
						if (gcResult.success) {
							logForDebugging(
								`[Compact] Post-hard-compact GC freed ${gcResult.freed ?? "unknown"} bytes`,
							);
						}
					})
					.catch(() => {
						/* non-blocking */
					});
				const boundaryMarker = createCompactBoundaryMessage(
					isAutoCompact ? "auto" : "manual",
					preCompactTokenCount ?? 0,
					messages.at(-1)?.uuid,
				);
				return {
					boundaryMarker,
					summaryMessages: [
						createUserMessage({
							content: `[Hard compact: ${hardResult.roundsProcessed} rounds truncated, ${hardResult.truncatedToolResults} tool results shortened, ${hardResult.truncatedAssistantTexts} assistant texts shortened. Recent ${hardResult.roundsKeptIntact} rounds preserved intact.]`,
						}),
					],
					attachments: [],
					hookResults: [],
					messagesToKeep: hardResult.messages,
					userDisplayMessage: `Hard compact: ${hardResult.truncatedToolResults} tool outputs shortened, recent ${hardResult.roundsKeptIntact} rounds kept intact`,
					preCompactTokenCount: hardResult.preCompactTokens,
					postCompactTokenCount: hardResult.postCompactTokens,
					truePostCompactTokenCount: hardResult.postCompactTokens,
				};
			}
			logForDebugging(
				`[Compact] Hard compact result ${hardResult.postCompactTokens} still over budget ${hardBudget}, falling back to LLM summarization`,
			);
		}

		const compactPrompt = getCompactPrompt(customInstructions);
		const summaryRequest = createUserMessage({
			content: compactPrompt,
		});

		let messagesToSummarize = messages;
		// Pre-flight: check the token budget before compacting on a local model, avoiding an oversized request that would OOM-crash
		const preflightTruncated = preflightMlxTokenTruncate(
			messages,
			cacheSafeParams.systemPrompt,
			context,
		);
		if (preflightTruncated) {
			logEvent("fusion_compact_mlx_preflight_truncate", {
				originalMessageCount: messages.length,
				truncatedMessageCount: preflightTruncated.length,
				preCompactTokenCount,
			});
			messagesToSummarize = preflightTruncated;
		}
		// If preflight truncated the messages, forkContextMessages must be updated in sync,
		// otherwise the fork-agent path sends the untruncated original messages to MLX and OOMs
		const retryCacheSafeParams = preflightTruncated
			? { ...cacheSafeParams, forkContextMessages: preflightTruncated }
			: cacheSafeParams;
		let summaryResponse: AssistantMessage;
		let summary: string | null;
		let _finalMessageCount: number;
		{
			const result = await runCompactSummaryWithTruncateRetry({
				messages: messagesToSummarize,
				summaryRequest,
				appState,
				context,
				preCompactTokenCount,
				cacheSafeParams: retryCacheSafeParams,
				logPrefix: "[Compact]",
				logFailed: (ptlAttempts, finalMessageCount, failReason) => {
					logEvent("fusion_compact_failed", {
						reason:
							failReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						preCompactTokenCount,
						promptCacheSharingEnabled,
						ptlAttempts,
						messagesSummarized: finalMessageCount,
					});
				},
			});
			summaryResponse = result.summaryResponse;
			summary = result.summary;
			_finalMessageCount = result.finalMessageCount;
		}

		if (!summary) {
			logForDebugging(
				`Compact failed: no summary text in response. Response: ${jsonStringify(summaryResponse)}`,
				{ level: "error" },
			);
			logEvent("fusion_compact_failed", {
				reason:
					"no_summary" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				preCompactTokenCount,
				promptCacheSharingEnabled,
			});
			throw new Error(
				`Failed to generate conversation summary - response did not contain valid text content`,
			);
		} else if (startsWithApiErrorPrefix(summary)) {
			logEvent("fusion_compact_failed", {
				reason:
					"api_error" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				preCompactTokenCount,
				promptCacheSharingEnabled,
			});
			throw new Error(summary);
		}

		// Store the current file state before clearing
		const preCompactReadFileState = cacheToObject(context.readFileState);

		// Clear the cache
		context.readFileState.clear();
		context.loadedNestedMemoryPaths?.clear();

		// Intentionally NOT resetting sentSkillNames: re-injecting the full
		// skill_listing (~4K tokens) post-compact is pure cache_creation with
		// marginal benefit. The model still has SkillTool in its schema and
		// invoked_skills attachment (below) preserves used-skill content. Ants
		// with EXPERIMENTAL_SKILL_SEARCH already skip re-injection via the
		// early-return in getSkillListingAttachments.

		// Run async attachment generation in parallel
		const [fileAttachments, asyncAgentAttachments] = await Promise.all([
			createPostCompactFileAttachments(
				preCompactReadFileState,
				context,
				POST_COMPACT_MAX_FILES_TO_RESTORE,
			),
			createAsyncAgentAttachmentsIfNeeded(context),
		]);

		const postCompactFileAttachments: AttachmentMessage[] = [
			...fileAttachments,
			...asyncAgentAttachments,
		];
		const planAttachment = createPlanAttachmentIfNeeded(context.agentId);
		if (planAttachment) {
			postCompactFileAttachments.push(planAttachment);
		}

		// Add plan mode instructions if currently in plan mode, so the model
		// continues operating in plan mode after compaction
		const planModeAttachment = await createPlanModeAttachmentIfNeeded(context);
		if (planModeAttachment) {
			postCompactFileAttachments.push(planModeAttachment);
		}

		// Add skill attachment if skills were invoked in this session
		const skillAttachment = createSkillAttachmentIfNeeded(context.agentId);
		if (skillAttachment) {
			postCompactFileAttachments.push(skillAttachment);
		}

		// Preserve sensitive instructions (customInstructions, appendSystemPrompt)
		// that would otherwise be lost after compaction
		const preservedAttachment = createPreservedInstructionsAttachment(
			customInstructions,
			context.options.appendSystemPrompt,
		);
		if (preservedAttachment) {
			postCompactFileAttachments.push(preservedAttachment);
		}

		// Compaction ate prior delta attachments. Re-announce from the current
		// state so the model has tool/instruction context on the first
		// post-compact turn. Empty message history → diff against nothing →
		// announces the full set.
		for (const att of getDeferredToolsDeltaAttachment(
			context.options.tools,
			context.options.mainLoopModel,
			[],
			{ callSite: "compact_full" },
		)) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}
		for (const att of getAgentListingDeltaAttachment(context, [])) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}
		for (const att of getMcpInstructionsDeltaAttachment(
			context.options.mcpClients,
			context.options.tools,
			context.options.mainLoopModel,
			[],
		)) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "session_start",
		});
		// Execute SessionStart hooks after successful compaction
		const hookMessages = await processSessionStartHooks("compact", {
			model: context.options.mainLoopModel,
		});

		// Create the compact boundary marker and summary messages before the
		// event so we can compute the true resulting-context size.
		const boundaryMarker = createCompactBoundaryMessage(
			isAutoCompact ? "auto" : "manual",
			preCompactTokenCount ?? 0,
			messages.at(-1)?.uuid,
		);
		// Carry loaded-tool state — the summary doesn't preserve tool_reference
		// blocks, so the post-compact schema filter needs this to keep sending
		// already-loaded deferred tool schemas to the API.
		const preCompactDiscovered = extractDiscoveredToolNames(messages);
		if (preCompactDiscovered.size > 0) {
			boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
				...preCompactDiscovered,
			].sort();
		}

		const transcriptPath = getTranscriptPath();
		const summaryMessages: UserMessage[] = [
			createUserMessage({
				content: getCompactUserSummaryMessage(
					summary,
					suppressFollowUpQuestions,
					transcriptPath,
				),
				isCompactSummary: true,
				isVisibleInTranscriptOnly: true,
			}),
		];

		// Previously "postCompactTokenCount" — renamed because this is the
		// compact API call's total usage (input_tokens ≈ preCompactTokenCount),
		// NOT the size of the resulting context. Kept for event-field continuity.
		const compactionCallTotalTokens = tokenCountFromLastAPIResponse([
			summaryResponse,
		]);

		// Message-payload estimate of the resulting context. The next iteration's
		// shouldAutoCompact will see this PLUS ~20-40K for system prompt + tools +
		// userContext (via API usage.input_tokens). So `willRetriggerNextTurn: true`
		// is a strong signal; `false` may still retrigger when this is close to threshold.
		const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
			boundaryMarker,
			...summaryMessages,
			...postCompactFileAttachments,
			...hookMessages,
		] as readonly {
			type: string;
			message?: { content?: unknown };
			attachment?: import("../../utils/attachments.js").Attachment;
		}[]);

		// Extract compaction API usage metrics
		const compactionUsage = getTokenUsage(summaryResponse);

		const querySourceForEvent =
			recompactionInfo?.querySource ?? context.options.querySource ?? "unknown";

		logEvent("fusion_compact", {
			preCompactTokenCount,
			// Kept for continuity — semantically the compact API call's total usage
			postCompactTokenCount: compactionCallTotalTokens,
			truePostCompactTokenCount,
			autoCompactThreshold: recompactionInfo?.autoCompactThreshold ?? -1,
			willRetriggerNextTurn:
				recompactionInfo !== undefined &&
				truePostCompactTokenCount >= recompactionInfo.autoCompactThreshold,
			isAutoCompact,
			querySource:
				querySourceForEvent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			queryChainId: (context.queryTracking?.chainId ??
				"") as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			queryDepth: context.queryTracking?.depth ?? -1,
			isRecompactionInChain: recompactionInfo?.isRecompactionInChain ?? false,
			turnsSincePreviousCompact:
				recompactionInfo?.turnsSincePreviousCompact ?? -1,
			previousCompactTurnId: (recompactionInfo?.previousCompactTurnId ??
				"") as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			compactionInputTokens: compactionUsage?.input_tokens,
			compactionOutputTokens: compactionUsage?.output_tokens,
			compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
			compactionCacheCreationTokens:
				compactionUsage?.cache_creation_input_tokens ?? 0,
			compactionTotalTokens: compactionUsage
				? compactionUsage.input_tokens +
					(compactionUsage.cache_creation_input_tokens ?? 0) +
					(compactionUsage.cache_read_input_tokens ?? 0) +
					compactionUsage.output_tokens
				: 0,
			promptCacheSharingEnabled,
			// analyzeContext walks every content block (~11ms on a 4.5K-message
			// session) purely for this telemetry breakdown. Computed here, past
			// the compaction-API await, so the sync walk doesn't starve the
			// render loop before compaction even starts. Same deferral pattern
			// as reactiveCompact.ts.
			...(() => {
				try {
					return tokenStatsToStatsigMetrics(analyzeContext(messages));
				} catch (error) {
					logError(error as Error);
					return {};
				}
			})(),
		});

		// Reset cache read baseline so the post-compact drop isn't flagged as a break
		if (feature("PROMPT_CACHE_BREAK_DETECTION")) {
			notifyCompaction(
				context.options.querySource ?? "compact",
				context.agentId,
			);
		}
		markPostCompaction();

		// Post-compact GC: release stale KV cache in fusion-mlx backend (fire-and-forget)
		if (isFusionMlxProvider()) {
			requestMlxGC()
				.then((gcResult) => {
					if (gcResult.success) {
						logForDebugging(
							`[Compact] Post-compact GC freed ${gcResult.freed ?? "unknown"} bytes`,
						);
					}
				})
				.catch(() => {
					/* non-blocking */
				});
		}

		// Re-append session metadata (custom title, tag) so it stays within
		// the 16KB tail window that readLiteMetadata reads for --resume display.
		// Without this, enough post-compaction messages push the metadata entry
		// out of the window, causing --resume to show the auto-generated title
		// instead of the user-set session name.
		reAppendSessionMetadata();

		// Write a reduced transcript segment for the pre-compaction messages
		// (assistant mode only). Fire-and-forget — errors are logged internally.
		if (feature("KAIROS")) {
			void sessionTranscriptModule?.writeSessionTranscriptSegment(messages);
		}

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "post_compact",
		});
		const postCompactHookResult = await executePostCompactHooks(
			{
				trigger: isAutoCompact ? "auto" : "manual",
				compactSummary: summary,
			},
			context.abortController.signal,
		);

		const combinedUserDisplayMessage = [
			userDisplayMessage,
			postCompactHookResult.userDisplayMessage,
		]
			.filter(Boolean)
			.join("\n");

		return {
			boundaryMarker,
			summaryMessages,
			attachments: postCompactFileAttachments,
			hookResults: hookMessages,
			userDisplayMessage: combinedUserDisplayMessage || undefined,
			preCompactTokenCount,
			postCompactTokenCount: compactionCallTotalTokens,
			truePostCompactTokenCount,
			compactionUsage,
		};
	} catch (error) {
		// Only show the error notification for manual /compact.
		// Auto-compact failures are retried on the next turn and the
		// notification is confusing when compaction eventually succeeds.
		if (!isAutoCompact) {
			addErrorNotificationIfNeeded(error, context);
		}
		throw error;
	} finally {
		context.setStreamMode?.("requesting");
		context.setResponseLength?.(() => 0);
		context.onCompactProgress?.({ type: "compact_end" });
		clearStallTimer(); // item 16: prevent stall-timer leaks (covers throw + early return)
		context.setSDKStatus?.(null);
	}
}

/**
 * Performs a partial compaction around the selected message index.
 * Direction 'from': summarizes messages after the index, keeps earlier ones.
 *   Prompt cache for kept (earlier) messages is preserved.
 * Direction 'up_to': summarizes messages before the index, keeps later ones.
 *   Prompt cache is invalidated since the summary precedes the kept messages.
 */
export async function partialCompactConversation(
	allMessages: Message[],
	pivotIndex: number,
	context: ToolUseContext,
	cacheSafeParams: CacheSafeParams,
	userFeedback?: string,
	direction: PartialCompactDirection = "from",
): Promise<CompactionResult> {
	// item 16: compact stall timer (same as compactConversation)
	let clearStallTimer: () => void = () => {};
	try {
		const messagesToSummarize =
			direction === "up_to"
				? allMessages.slice(0, pivotIndex)
				: allMessages.slice(pivotIndex);
		// 'up_to' must strip old compact boundaries/summaries: for 'up_to',
		// summary_B sits BEFORE kept, so a stale boundary_A in kept wins
		// findLastCompactBoundaryIndex's backward scan and drops summary_B.
		// 'from' keeps them: summary_B sits AFTER kept (backward scan still
		// works), and removing an old summary would lose its covered history.
		const messagesToKeep =
			direction === "up_to"
				? allMessages
						.slice(pivotIndex)
						.filter(
							(m) =>
								m.type !== "progress" &&
								!isCompactBoundaryMessage(m) &&
								!(m.type === "user" && m.isCompactSummary),
						)
				: allMessages.slice(0, pivotIndex).filter((m) => m.type !== "progress");

		if (messagesToSummarize.length === 0) {
			throw new Error(
				direction === "up_to"
					? "Nothing to summarize before the selected message."
					: "Nothing to summarize after the selected message.",
			);
		}

		const preCompactTokenCount = tokenCountWithEstimation(allMessages);

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "pre_compact",
		});

		context.setSDKStatus?.("compacting");
		const hookResult = await executePreCompactHooks(
			{
				trigger: "manual",
				customInstructions: null,
			},
			context.abortController.signal,
		);
		if (hookResult.blocked) {
			logForDebugging(
				`Partial compaction blocked by PreCompact hook: ${hookResult.stopReason}`,
			);
			context.onCompactProgress?.({ type: "compact_end" });
			return {
				boundaryMarker: createCompactBoundaryMessage("manual", 0, undefined),
				summaryMessages: [],
				attachments: [],
				hookResults: [],
				userDisplayMessage: hookResult.userDisplayMessage,
			};
		}

		// Merge hook instructions with user feedback
		let customInstructions: string | undefined;
		if (hookResult.newCustomInstructions && userFeedback) {
			customInstructions = `${hookResult.newCustomInstructions}\n\nUser context: ${userFeedback}`;
		} else if (hookResult.newCustomInstructions) {
			customInstructions = hookResult.newCustomInstructions;
		} else if (userFeedback) {
			customInstructions = `User context: ${userFeedback}`;
		}

		context.setStreamMode?.("requesting");
		context.setResponseLength?.(() => 0);
		context.onCompactProgress?.({ type: "compact_start" });
		// item 16: start the stall timer after compact_start, cleared in finally
		clearStallTimer = startCompactStallTimer(context, Date.now());

		const compactPrompt = getPartialCompactPrompt(
			customInstructions,
			direction,
		);
		const summaryRequest = createUserMessage({
			content: compactPrompt,
		});

		const failureMetadata = {
			preCompactTokenCount,
			direction:
				direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			// audit v3-0913 P2-2: messagesSummarized is not finalized here — the actual sent round count
			// is affected by preflight truncation and PTL retries; each consumer supplements it with finalMessageCount
		};

		// 'up_to' prefix hits cache directly; 'from' sends all (tail wouldn't cache).
		// PTL retry breaks the cache prefix but unblocks the user (CC-1180).
		let apiMessages = direction === "up_to" ? messagesToSummarize : allMessages;
		// Pre-flight: partial compact on a local MLX model also needs the token budget check
		const partialPreflight = preflightMlxTokenTruncate(
			apiMessages,
			cacheSafeParams.systemPrompt,
			context,
		);
		if (partialPreflight) {
			logEvent("fusion_compact_mlx_preflight_truncate", {
				originalMessageCount: apiMessages.length,
				truncatedMessageCount: partialPreflight.length,
				preCompactTokenCount,
				path: "partial" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			});
			apiMessages = partialPreflight;
		}
		const retryCacheSafeParams =
			direction === "up_to"
				? {
						...cacheSafeParams,
						forkContextMessages: partialPreflight ?? messagesToSummarize,
					}
				: partialPreflight
					? { ...cacheSafeParams, forkContextMessages: partialPreflight }
					: cacheSafeParams;
		let summaryResponse: AssistantMessage;
		let summary: string | null;
		let finalMessageCount: number;
		{
			const result = await runCompactSummaryWithTruncateRetry({
				messages: apiMessages,
				summaryRequest,
				appState: context.getAppState(),
				context,
				preCompactTokenCount,
				cacheSafeParams: retryCacheSafeParams,
				logPrefix: "[Partial Compact]",
				logFailed: (ptlAttempts, finalMessageCount, failReason) => {
					logEvent("fusion_partial_compact_failed", {
						reason:
							failReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
						...failureMetadata,
						messagesSummarized: finalMessageCount,
						ptlAttempts,
					});
				},
				retryLogExtra: {
					path: "partial" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				},
			});
			summaryResponse = result.summaryResponse;
			summary = result.summary;
			finalMessageCount = result.finalMessageCount;
		}
		if (!summary) {
			logEvent("fusion_partial_compact_failed", {
				reason:
					"no_summary" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				...failureMetadata,
				messagesSummarized: finalMessageCount,
			});
			throw new Error(
				"Failed to generate conversation summary - response did not contain valid text content",
			);
		} else if (startsWithApiErrorPrefix(summary)) {
			logEvent("fusion_partial_compact_failed", {
				reason:
					"api_error" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				...failureMetadata,
				messagesSummarized: finalMessageCount,
			});
			throw new Error(summary);
		}

		// Store the current file state before clearing
		const preCompactReadFileState = cacheToObject(context.readFileState);
		context.readFileState.clear();
		context.loadedNestedMemoryPaths?.clear();
		// Intentionally NOT resetting sentSkillNames — see compactConversation()
		// for rationale (~4K tokens saved per compact event).

		const [fileAttachments, asyncAgentAttachments] = await Promise.all([
			createPostCompactFileAttachments(
				preCompactReadFileState,
				context,
				POST_COMPACT_MAX_FILES_TO_RESTORE,
				messagesToKeep,
			),
			createAsyncAgentAttachmentsIfNeeded(context),
		]);

		const postCompactFileAttachments: AttachmentMessage[] = [
			...fileAttachments,
			...asyncAgentAttachments,
		];
		const planAttachment = createPlanAttachmentIfNeeded(context.agentId);
		if (planAttachment) {
			postCompactFileAttachments.push(planAttachment);
		}

		// Add plan mode instructions if currently in plan mode
		const planModeAttachment = await createPlanModeAttachmentIfNeeded(context);
		if (planModeAttachment) {
			postCompactFileAttachments.push(planModeAttachment);
		}

		const skillAttachment = createSkillAttachmentIfNeeded(context.agentId);
		if (skillAttachment) {
			postCompactFileAttachments.push(skillAttachment);
		}

		// Preserve sensitive instructions for partial compact too
		const preservedAttachment = createPreservedInstructionsAttachment(
			customInstructions,
			context.options.appendSystemPrompt,
		);
		if (preservedAttachment) {
			postCompactFileAttachments.push(preservedAttachment);
		}

		// Re-announce only what was in the summarized portion — messagesToKeep
		// is scanned, so anything already announced there is skipped.
		for (const att of getDeferredToolsDeltaAttachment(
			context.options.tools,
			context.options.mainLoopModel,
			messagesToKeep,
			{ callSite: "compact_partial" },
		)) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}
		for (const att of getAgentListingDeltaAttachment(context, messagesToKeep)) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}
		for (const att of getMcpInstructionsDeltaAttachment(
			context.options.mcpClients,
			context.options.tools,
			context.options.mainLoopModel,
			messagesToKeep,
		)) {
			postCompactFileAttachments.push(createAttachmentMessage(att));
		}

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "session_start",
		});
		const hookMessages = await processSessionStartHooks("compact", {
			model: context.options.mainLoopModel,
		});

		const postCompactTokenCount = tokenCountFromLastAPIResponse([
			summaryResponse,
		]);
		const compactionUsage = getTokenUsage(summaryResponse);

		logEvent("fusion_partial_compact", {
			preCompactTokenCount,
			postCompactTokenCount,
			messagesKept: messagesToKeep.length,
			// Actual rounds after truncate-retries (audit v3-0913 P1): the caller's local variable is no
			// longer written back by the loop; the original length would overstate the stats
			messagesSummarized: finalMessageCount,
			direction:
				direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			hasUserFeedback: !!userFeedback,
			trigger:
				"message_selector" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			compactionInputTokens: compactionUsage?.input_tokens,
			compactionOutputTokens: compactionUsage?.output_tokens,
			compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
			compactionCacheCreationTokens:
				compactionUsage?.cache_creation_input_tokens ?? 0,
		});

		// Progress messages aren't loggable, so forkSessionImpl would null out
		// a logicalParentUuid pointing at one. Both directions skip them.
		const lastPreCompactUuid =
			direction === "up_to"
				? allMessages
						.slice(0, pivotIndex)
						.findLast((m) => m.type !== "progress")?.uuid
				: messagesToKeep.at(-1)?.uuid;
		const boundaryMarker = createCompactBoundaryMessage(
			"manual",
			preCompactTokenCount ?? 0,
			lastPreCompactUuid,
			userFeedback,
			messagesToSummarize.length,
		);
		// allMessages not just messagesToSummarize — set union is idempotent,
		// simpler than tracking which half each tool lived in.
		const preCompactDiscovered = extractDiscoveredToolNames(allMessages);
		if (preCompactDiscovered.size > 0) {
			boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
				...preCompactDiscovered,
			].sort();
		}

		const transcriptPath = getTranscriptPath();
		const summaryMessages: UserMessage[] = [
			createUserMessage({
				content: getCompactUserSummaryMessage(summary, false, transcriptPath),
				isCompactSummary: true,
				...(messagesToKeep.length > 0
					? {
							summarizeMetadata: {
								messagesSummarized: finalMessageCount,
								userContext: userFeedback,
								direction,
							},
						}
					: { isVisibleInTranscriptOnly: true as const }),
			}),
		];

		if (feature("PROMPT_CACHE_BREAK_DETECTION")) {
			notifyCompaction(
				context.options.querySource ?? "compact",
				context.agentId,
			);
		}
		markPostCompaction();

		// Re-append session metadata (custom title, tag) so it stays within
		// the 16KB tail window that readLiteMetadata reads for --resume display.
		reAppendSessionMetadata();

		if (feature("KAIROS")) {
			void sessionTranscriptModule?.writeSessionTranscriptSegment(
				messagesToSummarize,
			);
		}

		context.onCompactProgress?.({
			type: "hooks_start",
			hookType: "post_compact",
		});
		const postCompactHookResult = await executePostCompactHooks(
			{
				trigger: "manual",
				compactSummary: summary,
			},
			context.abortController.signal,
		);

		// 'from': prefix-preserving → boundary; 'up_to': suffix → last summary
		const anchorUuid =
			direction === "up_to"
				? (summaryMessages.at(-1)?.uuid ?? boundaryMarker.uuid)
				: boundaryMarker.uuid;
		return {
			boundaryMarker: annotateBoundaryWithPreservedSegment(
				boundaryMarker,
				anchorUuid,
				messagesToKeep,
			),
			summaryMessages,
			messagesToKeep,
			attachments: postCompactFileAttachments,
			hookResults: hookMessages,
			userDisplayMessage: postCompactHookResult.userDisplayMessage,
			preCompactTokenCount,
			postCompactTokenCount,
			compactionUsage,
		};
	} catch (error) {
		addErrorNotificationIfNeeded(error, context);
		throw error;
	} finally {
		context.setStreamMode?.("requesting");
		context.setResponseLength?.(() => 0);
		context.onCompactProgress?.({ type: "compact_end" });
		clearStallTimer(); // item 16: prevent stall-timer leaks (covers throw + early return)
		context.setSDKStatus?.(null);
	}
}

function addErrorNotificationIfNeeded(
	error: unknown,
	context: Pick<ToolUseContext, "addNotification">,
) {
	if (
		!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) &&
		!hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
	) {
		context.addNotification?.({
			key: "error-compacting-conversation",
			text: "Error compacting conversation",
			priority: "immediate",
			color: "error",
		});
	}
}

export function createCompactCanUseTool(): CanUseToolFn {
	return async () => ({
		behavior: "deny" as const,
		message: "Tool use is not allowed during compaction",
		decisionReason: {
			type: "other" as const,
			reason: "compaction agent should only produce text summary",
		},
	});
}

async function streamCompactSummary({
	messages,
	summaryRequest,
	appState,
	context,
	preCompactTokenCount,
	cacheSafeParams,
}: {
	messages: Message[];
	summaryRequest: UserMessage;
	appState: Awaited<ReturnType<ToolUseContext["getAppState"]>>;
	context: ToolUseContext;
	preCompactTokenCount: number;
	cacheSafeParams: CacheSafeParams;
}): Promise<AssistantMessage> {
	// When prompt cache sharing is enabled, use forked agent to reuse the
	// main conversation's cached prefix (system prompt, tools, context messages).
	// Falls back to regular streaming path on failure.
	// 3P default: true — see comment at the other fusion_compact_cache_prefix read above.
	const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
		"fusion_compact_cache_prefix",
		true,
	);
	// Send keep-alive signals during compaction to prevent remote session
	// WebSocket idle timeouts from dropping bridge connections. Compaction
	// API calls can take 5-10+ seconds, during which no other messages
	// flow through the transport — without keep-alives, the server may
	// close the WebSocket for inactivity.
	// Two signals: (1) PUT /worker heartbeat via sessionActivity, and
	// (2) re-emit 'compacting' status so the SDK event stream stays active
	// and the server doesn't consider the session stale.
	const activityInterval = isSessionActivityTrackingActive()
		? setInterval(
				(statusSetter?: (status: "compacting" | null) => void) => {
					sendSessionActivitySignal();
					statusSetter?.("compacting");
				},
				30_000,
				context.setSDKStatus,
			)
		: undefined;

	// Cloud/gateway models: when input + the default output budget exceed the contextWindow, squeeze the output tokens
	// to avoid 400 ContextWindowExceededError. undefined = within the window, keep the original value.
	// Computed once at function entry: the fork path uses it to decide whether to skip (avoiding falling back to
	// streaming only after a 400); the streaming path reuses the same value as maxOutputTokensOverride.
	const compactOutputCap = getCompactOutputTokenCap(
		context.options.mainLoopModel,
		tokenCountWithEstimation(messages),
	);
	const defaultCompactMaxOutputTokens = Math.min(
		COMPACT_MAX_OUTPUT_TOKENS,
		getMaxOutputTokensForModel(context.options.mainLoopModel),
	);

	try {
		// When the input is near the window cap (compactOutputCap already triggered compression), the fork path inherits
		// the model's default maxOutputTokens (~32K); input+default also exceeds the window → guaranteed 400.
		// In this scenario there is no valid cache prefix to reuse (input is full), so skip fork and go straight to streaming;
		// streaming already compresses output per compactOutputCap, avoiding a fork call guaranteed to fail.
		// Skip fork for image/document content too: fork sends messages as-is to keep the cache prefix consistent
		// (media blocks cannot be stripped, otherwise cache miss), while the streaming path strips media blocks —
		// rather than letting fork absorb the image bytes and fall back to streaming on failure, just go straight to streaming.
		if (
			promptCacheSharingEnabled &&
			compactOutputCap === undefined &&
			!messagesContainMediaBlocks(messages)
		) {
			try {
				// DO NOT set maxOutputTokens here. The fork piggybacks on the main thread's
				// prompt cache by sending identical cache-key params (system, tools, model,
				// messages prefix, thinking config). Setting maxOutputTokens would clamp
				// budget_tokens via Math.min(budget, maxOutputTokens-1) in claude.ts,
				// creating a thinking config mismatch that invalidates the cache.
				// The streaming fallback path (below) can safely set maxOutputTokensOverride
				// since it doesn't share cache with the main thread.
				// MLX: compact agent cannot use tools (canUseTool denies everything),
				// but the full tool definitions are still sent in the API request,
				// consuming ~5K tokens on 32K windows. Strip tools for MLX to save
				// context — compact only needs to produce a text summary.
				const compactCacheSafeParams = isFusionMlxProvider()
					? {
							...cacheSafeParams,
							toolUseContext: {
								...cacheSafeParams.toolUseContext,
								options: {
									...cacheSafeParams.toolUseContext.options,
									tools: [],
								},
							},
						}
					: cacheSafeParams;
				const result = await runForkedAgent({
					promptMessages: [summaryRequest],
					cacheSafeParams: compactCacheSafeParams,
					canUseTool: createCompactCanUseTool(),
					querySource: "compact",
					forkLabel: "compact",
					maxTurns: 1,
					skipCacheWrite: true,
					// Pass the compact context's abortController so user Esc aborts the
					// fork — same signal the streaming fallback uses at
					// `signal: context.abortController.signal` below.
					overrides: { abortController: context.abortController },
				});
				const assistantMsg = getLastAssistantMessage(result.messages);
				const assistantText = assistantMsg
					? getAssistantMessageText(assistantMsg)
					: null;
				// Guard isApiErrorMessage: query() catches API errors (including
				// APIUserAbortError on ESC) and yields them as synthetic assistant
				// messages. Without this check, an aborted compact "succeeds" with
				// "Request was aborted." as the summary — the text doesn't start with
				// "API Error" so the caller's startsWithApiErrorPrefix guard misses it.
				if (assistantMsg && assistantText && !assistantMsg.isApiErrorMessage) {
					// Skip success logging for PTL error text — it's returned so the
					// caller's retry loop catches it, but it's not a successful summary.
					if (!assistantText.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
						logEvent("fusion_compact_cache_sharing_success", {
							preCompactTokenCount,
							outputTokens: result.totalUsage.output_tokens,
							cacheReadInputTokens: result.totalUsage.cache_read_input_tokens,
							cacheCreationInputTokens:
								result.totalUsage.cache_creation_input_tokens,
							cacheHitRate:
								result.totalUsage.cache_read_input_tokens > 0
									? result.totalUsage.cache_read_input_tokens /
										(result.totalUsage.cache_read_input_tokens +
											result.totalUsage.cache_creation_input_tokens +
											result.totalUsage.input_tokens)
									: 0,
						});
					}
					return assistantMsg;
				}
				logForDebugging(
					`Compact cache sharing: no text in response, falling back. Response: ${jsonStringify(assistantMsg)}`,
					{ level: "warn" },
				);
				logEvent("fusion_compact_cache_sharing_fallback", {
					reason:
						"no_text_response" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					preCompactTokenCount,
				});
			} catch (error) {
				logError(error);
				logEvent("fusion_compact_cache_sharing_fallback", {
					reason:
						"error" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
					preCompactTokenCount,
				});
			}
		}

		// Regular streaming path (fallback when cache sharing fails or is disabled)
		const retryEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
			"fusion_compact_streaming_retry",
			false,
		);
		const maxAttempts = retryEnabled ? MAX_COMPACT_STREAMING_RETRIES : 1;

		// Loop invariants (audit v2-0912 P2): tool list + tool-search decision
		// don't change across streaming retries — hoisted out of the retry loop
		// so attempt 2+ don't redo the (awaited) isToolSearchEnabled probe.
		// Check if tool search is enabled using the main loop's tools list.
		// context.options.tools includes MCP tools merged via useMergedTools.
		const useToolSearch = await isToolSearchEnabled(
			context.options.mainLoopModel,
			context.options.tools,
			async () => appState.toolPermissionContext,
			context.options.agentDefinitions.activeAgents,
			"compact",
		);

		// When tool search is enabled, include ToolSearchTool and MCP tools. They get
		// defer_loading: true and don't count against context - the API filters them out
		// of system_prompt_tools before token counting (see api/token_count_api/counting.py:188
		// and api/public_api/messages/handler.py:324).
		// Filter MCP tools from context.options.tools (not appState.mcp.tools) so we
		// get the permission-filtered set from useMergedTools — same source used for
		// isToolSearchEnabled above and normalizeMessagesForAPI below.
		// Deduplicate by name to avoid API errors when MCP tools share names with built-in tools.
		const tools: Tool[] = useToolSearch
			? uniqBy(
					[
						FileReadTool,
						ToolSearchTool,
						...context.options.tools.filter((t) => t.isMcp),
					],
					"name",
				)
			: [FileReadTool];

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			// Reset state for retry
			let hasStartedStreaming = false;
			let response: AssistantMessage | undefined;
			context.setResponseLength?.(() => 0);

			// Reuse the compactOutputCap computed at function entry: compress output to avoid 400
			// (undefined = within the window, use the original fixed value, byte-identical).
			const streamingMaxOutputTokens =
				compactOutputCap ?? defaultCompactMaxOutputTokens;

			const streamingGen = queryModelWithStreaming({
				messages: normalizeMessagesForAPI(
					stripImagesFromMessages(
						stripReinjectedAttachments([
							...getMessagesAfterCompactBoundary(messages),
							summaryRequest,
						]),
					),
					context.options.tools,
				),
				systemPrompt: asSystemPrompt([
					"You are a helpful AI assistant tasked with summarizing conversations.",
				]),
				thinkingConfig: { type: "disabled" as const },
				tools,
				signal: context.abortController.signal,
				options: {
					async getToolPermissionContext() {
						const appState = context.getAppState();
						return appState.toolPermissionContext;
					},
					model: context.options.mainLoopModel,
					toolChoice: undefined,
					isNonInteractiveSession: context.options.isNonInteractiveSession,
					hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
					maxOutputTokensOverride: streamingMaxOutputTokens,
					querySource: "compact",
					agents: context.options.agentDefinitions.activeAgents,
					mcpTools: [],
					effortValue: appState.effortValue,
				},
			});
			const streamIter = streamingGen[Symbol.asyncIterator]();
			let next = await streamIter.next();

			while (!next.done) {
				const event = next.value as
					| AssistantMessage
					| SystemAPIErrorMessage
					| StreamEvent;

				if (
					!hasStartedStreaming &&
					event.type === "stream_event" &&
					event.event.type === "content_block_start" &&
					event.event.content_block.type === "text"
				) {
					hasStartedStreaming = true;
					context.setStreamMode?.("responding");
				}

				if (
					event.type === "stream_event" &&
					event.event.type === "content_block_delta" &&
					event.event.delta.type === "text_delta"
				) {
					const charactersStreamed = event.event.delta.text.length;
					context.setResponseLength?.((length) => length + charactersStreamed);
				}

				if (event.type === "assistant") {
					response = event;
				}

				next = await streamIter.next();
			}

			if (response) {
				return response;
			}

			if (attempt < maxAttempts) {
				logEvent("fusion_compact_streaming_retry", {
					attempt,
					preCompactTokenCount,
					hasStartedStreaming,
				});
				await sleep(getRetryDelay(attempt), context.abortController.signal, {
					abortError: () => {
						// log: no dependency on the SDK's AbortError factory — sleep only requires () => Error
						const err = new Error("Request was aborted.");
						err.name = "AbortError";
						return err;
					},
				});
				continue;
			}

			logForDebugging(
				`Compact streaming failed after ${attempt} attempts. hasStartedStreaming=${hasStartedStreaming}`,
				{ level: "error" },
			);
			logEvent("fusion_compact_failed", {
				reason:
					"no_streaming_response" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				preCompactTokenCount,
				hasStartedStreaming,
				retryEnabled,
				attempts: attempt,
				promptCacheSharingEnabled,
			});
			throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE);
		}

		// This should never be reached due to the throw above, but TypeScript needs it
		throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE);
	} finally {
		clearInterval(activityInterval);
	}
}

/**
 * Creates attachment messages for recently accessed files to restore them after compaction.
 * This prevents the model from having to re-read files that were recently accessed.
 * Re-reads files using FileReadTool to get fresh content with proper validation.
 * Files are selected based on recency, but constrained by both file count and token budget limits.
 *
 * Files already present as Read tool results in preservedMessages are skipped —
 * re-injecting identical content the model can already see in the preserved tail
 * is pure waste (up to 25K tok/compact). Mirrors the diff-against-preserved
 * pattern that getDeferredToolsDeltaAttachment uses at the same call sites.
 *
 * @param readFileState The current file state tracking recently read files
 * @param toolUseContext The tool use context for calling FileReadTool
 * @param maxFiles Maximum number of files to restore (default: 5)
 * @param preservedMessages Messages kept post-compact; Read results here are skipped
 * @returns Array of attachment messages for the most recently accessed files that fit within token budget
 */
export async function createPostCompactFileAttachments(
	readFileState: Record<string, { content: string; timestamp: number }>,
	toolUseContext: ToolUseContext,
	maxFiles: number,
	preservedMessages: Message[] = [],
): Promise<AttachmentMessage[]> {
	const preservedReadPaths = collectReadToolFilePaths(preservedMessages);
	const recentFiles = Object.entries(readFileState)
		.map(([filename, state]) => ({ filename, ...state }))
		.filter(
			(file) =>
				!shouldExcludeFromPostCompactRestore(
					file.filename,
					toolUseContext.agentId,
				) && !preservedReadPaths.has(expandPath(file.filename)),
		)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, maxFiles);

	const results = await Promise.all(
		recentFiles.map(async (file) => {
			const attachment = await generateFileAttachment(
				file.filename,
				{
					...toolUseContext,
					fileReadingLimits: {
						maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE,
					},
				},
				"fusion_post_compact_file_restore_success",
				"fusion_post_compact_file_restore_error",
				"compact",
			);
			return attachment ? createAttachmentMessage(attachment) : null;
		}),
	);

	let usedTokens = 0;
	return results.filter((result): result is AttachmentMessage => {
		if (result === null) {
			return false;
		}
		const attachmentTokens = roughTokenCountEstimation(jsonStringify(result));
		if (usedTokens + attachmentTokens <= POST_COMPACT_TOKEN_BUDGET) {
			usedTokens += attachmentTokens;
			return true;
		}
		return false;
	});
}

/**
 * Creates a plan file attachment if a plan file exists for the current session.
 * This ensures the plan is preserved after compaction.
 */
export function createPlanAttachmentIfNeeded(
	agentId?: AgentId,
): AttachmentMessage | null {
	const planContent = getPlan(agentId);

	if (!planContent) {
		return null;
	}

	const planFilePath = getPlanFilePath(agentId);

	return createAttachmentMessage({
		type: "plan_file_reference",
		planFilePath,
		planContent,
	});
}

/**
 * Creates an attachment for invoked skills to preserve their content across compaction.
 * Only includes skills scoped to the given agent (or main session when agentId is null/undefined).
 * This ensures skill guidelines remain available after the conversation is summarized
 * without leaking skills from other agent contexts.
 */
export function createSkillAttachmentIfNeeded(
	agentId?: string,
): AttachmentMessage | null {
	const invokedSkills = getInvokedSkillsForAgent(agentId);

	if (invokedSkills.size === 0) {
		return null;
	}

	// Sorted most-recent-first so budget pressure drops the least-relevant skills.
	// Per-skill truncation keeps the head of each file (where setup/usage
	// instructions typically live) rather than dropping whole skills.
	let usedTokens = 0;
	const skills = Array.from(invokedSkills.values())
		.sort((a, b) => b.invokedAt - a.invokedAt)
		.map((skill) => ({
			name: skill.skillName,
			path: skill.skillPath,
			content: truncateToTokens(
				skill.content,
				POST_COMPACT_MAX_TOKENS_PER_SKILL,
			),
		}))
		.filter((skill) => {
			const tokens = roughTokenCountEstimation(skill.content);
			if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) {
				return false;
			}
			usedTokens += tokens;
			return true;
		});

	if (skills.length === 0) {
		return null;
	}

	return createAttachmentMessage({
		type: "invoked_skills",
		skills,
	});
}

const PRESERVED_INSTRUCTIONS_TOKEN_BUDGET = 4000;

export function createPreservedInstructionsAttachment(
	customInstructions?: string,
	appendSystemPrompt?: string,
): AttachmentMessage | null {
	const instructions: Array<{ source: string; content: string }> = [];
	let usedTokens = 0;

	if (customInstructions?.trim()) {
		const tokens = roughTokenCountEstimation(customInstructions);
		if (usedTokens + tokens <= PRESERVED_INSTRUCTIONS_TOKEN_BUDGET) {
			instructions.push({
				source: "custom_instructions",
				content: customInstructions,
			});
			usedTokens += tokens;
		} else {
			const truncated = truncateToTokens(
				customInstructions,
				PRESERVED_INSTRUCTIONS_TOKEN_BUDGET - usedTokens,
			);
			instructions.push({
				source: "custom_instructions",
				content: truncated,
			});
			usedTokens += roughTokenCountEstimation(truncated);
		}
	}

	if (appendSystemPrompt?.trim()) {
		const tokens = roughTokenCountEstimation(appendSystemPrompt);
		if (usedTokens + tokens <= PRESERVED_INSTRUCTIONS_TOKEN_BUDGET) {
			instructions.push({
				source: "append_system_prompt",
				content: appendSystemPrompt,
			});
			usedTokens += tokens;
		} else {
			const truncated = truncateToTokens(
				appendSystemPrompt,
				PRESERVED_INSTRUCTIONS_TOKEN_BUDGET - usedTokens,
			);
			instructions.push({
				source: "append_system_prompt",
				content: truncated,
			});
			usedTokens += roughTokenCountEstimation(truncated);
		}
	}

	if (instructions.length === 0) {
		return null;
	}

	logForDebugging(
		`[Compact] Preserved instructions: ${instructions.map((i) => `${i.source}(${roughTokenCountEstimation(i.content)}t)`).join(", ")}`,
	);

	return createAttachmentMessage({
		type: "preserved_instructions",
		instructions,
	});
}

/**
 * Creates a plan_mode attachment if the user is currently in plan mode.
 * This ensures the model continues to operate in plan mode after compaction
 * (otherwise it would lose the plan mode instructions since those are
 * normally only injected on tool-use turns via getAttachmentMessages).
 */
export async function createPlanModeAttachmentIfNeeded(
	context: ToolUseContext,
): Promise<AttachmentMessage | null> {
	const appState = context.getAppState();
	if (appState.toolPermissionContext.mode !== "plan") {
		return null;
	}

	const planFilePath = getPlanFilePath(context.agentId);
	const planExists = getPlan(context.agentId) !== null;

	return createAttachmentMessage({
		type: "plan_mode",
		reminderType: "full",
		isSubAgent: !!context.agentId,
		planFilePath,
		planExists,
	});
}

/**
 * Creates attachments for async agents so the model knows about them after
 * compaction. Covers both agents still running in the background (so the model
 * doesn't spawn a duplicate) and agents that have finished but whose results
 * haven't been retrieved yet.
 */
export async function createAsyncAgentAttachmentsIfNeeded(
	context: ToolUseContext,
): Promise<AttachmentMessage[]> {
	const appState = context.getAppState();
	const asyncAgents = Object.values(appState.tasks).filter(
		(task): task is LocalAgentTaskState => task.type === "local_agent",
	);

	return asyncAgents.flatMap((agent) => {
		if (
			agent.retrieved ||
			agent.status === "pending" ||
			agent.agentId === context.agentId
		) {
			return [];
		}
		return [
			createAttachmentMessage({
				type: "task_status",
				taskId: agent.agentId,
				taskType: "local_agent",
				description: agent.description,
				status: agent.status,
				deltaSummary:
					agent.status === "running"
						? (agent.progress?.summary ?? null)
						: (agent.error ?? null),
				outputFilePath: getTaskOutputPath(agent.agentId),
			}),
		];
	});
}

/**
 * Scan messages for Read tool_use blocks and collect their file_path inputs
 * (normalized via expandPath). Used to dedup post-compact file restoration
 * against what's already visible in the preserved tail.
 *
 * Skips Reads whose tool_result is a dedup stub — the stub points at an
 * earlier full Read that may have been compacted away, so we want
 * createPostCompactFileAttachments to re-inject the real content.
 */
function collectReadToolFilePaths(messages: Message[]): Set<string> {
	const stubIds = new Set<string>();
	for (const message of messages) {
		if (message.type !== "user" || !Array.isArray(message.message.content)) {
			continue;
		}
		for (const block of message.message.content) {
			if (
				block.type === "tool_result" &&
				typeof block.content === "string" &&
				block.content.startsWith(FILE_UNCHANGED_STUB)
			) {
				stubIds.add(block.tool_use_id);
			}
		}
	}

	const paths = new Set<string>();
	for (const message of messages) {
		if (
			message.type !== "assistant" ||
			!Array.isArray(message.message.content)
		) {
			continue;
		}
		for (const block of message.message.content) {
			if (
				block.type !== "tool_use" ||
				block.name !== FILE_READ_TOOL_NAME ||
				stubIds.has(block.id)
			) {
				continue;
			}
			const input = block.input;
			if (
				input &&
				typeof input === "object" &&
				"file_path" in input &&
				typeof input.file_path === "string"
			) {
				paths.add(expandPath(input.file_path));
			}
		}
	}
	return paths;
}

const SKILL_TRUNCATION_MARKER =
	"\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]";

/**
 * Truncate content to roughly maxTokens, keeping the head. roughTokenCountEstimation
 * uses ~4 chars/token (its default bytesPerToken), so char budget = maxTokens * 4
 * minus the marker so the result stays within budget. Marker tells the model it
 * can Read the full file if needed.
 */
function truncateToTokens(content: string, maxTokens: number): string {
	// Budget exhausted (maxTokens <= 0): return the bare marker. Without this
	// guard, charBudget goes negative and slice(0, negative) keeps the TAIL of
	// the content — output ends up longer than the input (truncation silently
	// inverted), re-inflating context right after compaction.
	if (maxTokens <= 0) {
		return SKILL_TRUNCATION_MARKER;
	}
	if (roughTokenCountEstimation(content) <= maxTokens) {
		return content;
	}
	// Math.max guards tiny positive budgets where the marker alone exceeds
	// maxTokens*4 (charBudget would still go negative).
	const charBudget = Math.max(
		0,
		maxTokens * 4 - SKILL_TRUNCATION_MARKER.length,
	);
	return content.slice(0, charBudget) + SKILL_TRUNCATION_MARKER;
}

function shouldExcludeFromPostCompactRestore(
	filename: string,
	agentId?: AgentId,
): boolean {
	const normalizedFilename = expandPath(filename);
	// Exclude plan files
	try {
		const planFilePath = expandPath(getPlanFilePath(agentId));
		if (normalizedFilename === planFilePath) {
			return true;
		}
	} catch {
		// If we can't get plan file path, continue with other checks
	}

	// Exclude all types of claude.md files
	// TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
	// and to also match child directory memory files (.claude/rules/*.md, etc.)
	try {
		const normalizedMemoryPaths = new Set(
			MEMORY_TYPE_VALUES.map((type) => expandPath(getMemoryPath(type))),
		);

		if (normalizedMemoryPaths.has(normalizedFilename)) {
			return true;
		}
	} catch {
		// If we can't get memory paths, continue
	}

	return false;
}
