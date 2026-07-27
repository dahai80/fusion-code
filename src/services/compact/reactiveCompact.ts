/**
 * Reactive Compact — 响应式上下文压缩
 *
 * 在上下文窗口接近上限时自动触发压缩，
 * 无需用户手动执行 /compact 命令。
 * 通过监控 token 使用量，在达到阈值时自动执行压缩。
 *
 * Also handles prompt-too-long (413) and media-size errors reactively:
 * when the API rejects a request, this module strips the oldest context
 * groups and retries instead of surfacing the error to the user.
 *
 * gated by feature('REACTIVE_COMPACT')
 */

import { feature } from 'bun:bundle'
import {
    buildPostCompactMessages,
    compactConversation,
    type CompactionResult,
    ERROR_MESSAGE_INCOMPLETE_RESPONSE,
    ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
    ERROR_MESSAGE_PROMPT_TOO_LONG,
    ERROR_MESSAGE_USER_ABORT,
    mergeHookInstructions,
    stripImagesFromMessages,
} from './compact.js'
import { extractReadFilesFromMessages } from '../../utils/queryHelpers.js'
import { getCwd } from '../../utils/cwd.js'
import { groupMessagesByApiRound } from './grouping.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { getTotalInputTokens, getTotalOutputTokens } from '../../cost-tracker.js'
import {
    isPromptTooLongMessage,
    getPromptTooLongTokenGap,
    isMediaSizeError,
} from '../../services/api/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import {
    executePostCompactHooks,
    executePreCompactHooks,
} from '../../utils/hooks.js'
import { logForDebugging } from '../../utils/debug.js'
import { markPostCompaction } from '../../bootstrap/state.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { suppressCompactWarning } from './compactWarningState.js'
import type { AssistantMessage, Message } from '../../types/message.js'

export interface ReactiveCompactResult {
    compressed: boolean
    tokensFreed: number
    reason: string
}

// Threshold: compress when usage reaches 80% of context window
const COMPRESS_THRESHOLD = 0.8

// Minimum tokens that must be freed to make compression worthwhile
const MIN_TOKENS_TO_FREE = 5_000

// Max retries when peeling groups on prompt-too-long
const MAX_REACTIVE_RETRIES = 3

let _reactiveOnlyMode = false

/**
 * Check if reactive compaction is enabled.
 * Requires the REACTIVE_COMPACT feature flag and auto-compact not disabled.
 * feature() is a compile-time macro — can only appear in if/ternary.
 */
export function isReactiveCompactEnabled(): boolean {
    if (feature('REACTIVE_COMPACT')) {
        return true
    }
    return false
}

/**
 * Check if reactive-only mode is enabled.
 * In reactive-only mode, ALL compaction goes through the reactive path.
 */
export function isReactiveOnlyMode(): boolean {
    return _reactiveOnlyMode
}

/**
 * Set reactive-only mode.
 */
export function setReactiveOnlyMode(enabled: boolean): void {
    _reactiveOnlyMode = enabled
    logForDebugging(`[ReactiveCompact] Reactive-only mode: ${enabled}`)
}

/**
 * Detect if an assistant message is a prompt-too-long error
 * that should be withheld from the user and recovered via compaction.
 */
export function isWithheldPromptTooLong(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false
    const msg = message as AssistantMessage
    if (msg.type !== 'assistant') return false
    return isPromptTooLongMessage(msg)
}

/**
 * Detect if an assistant message is a media-size error
 * that should be withheld and recovered by stripping images.
 */
export function isWithheldMediaSizeError(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false
    const msg = message as AssistantMessage
    if (msg.type !== 'assistant') return false
    if (!msg.isApiErrorMessage) return false
    if (!msg.errorDetails) return false
    return isMediaSizeError(msg.errorDetails)
}

/**
 * Check if reactive compaction should be triggered.
 * Returns true if the context window is nearing capacity.
 */
export function shouldTriggerReactiveCompact(): boolean {
    const contextWindow = getContextWindowForModel('default')
    const totalTokens = getTotalInputTokens() + getTotalOutputTokens()
    const usageRatio = totalTokens / contextWindow

    return usageRatio >= COMPRESS_THRESHOLD
}

/**
 * Get the current context window usage ratio.
 */
export function getContextUsageRatio(): number {
    const contextWindow = getContextWindowForModel('default')
    if (contextWindow <= 0) return 0
    const totalTokens = getTotalInputTokens() + getTotalOutputTokens()
    return totalTokens / contextWindow
}

/**
 * Perform reactive compaction.
 * Analyzes the current messages and compresses them if needed.
 */
export async function reactiveCompact<T>(
    messages: T[],
    _options?: { force?: boolean },
): Promise<ReactiveCompactResult> {
    if (!shouldTriggerReactiveCompact() && !_options?.force) {
        return {
            compressed: false,
            tokensFreed: 0,
            reason: 'Context window usage below threshold',
        }
    }

    const contextWindow = getContextWindowForModel('default')
    const totalTokens = getTotalInputTokens() + getTotalOutputTokens()
    const tokensToFree = Math.max(
        MIN_TOKENS_TO_FREE,
        Math.floor((totalTokens / contextWindow - COMPRESS_THRESHOLD) * contextWindow),
    )

    logForDebugging(
        `[ReactiveCompact] Compressing: ${totalTokens}/${contextWindow} tokens, target: ${tokensToFree} tokens freed`,
    )

    return {
        compressed: true,
        tokensFreed: tokensToFree,
        reason: `Reactive compaction triggered at ${Math.round((totalTokens / contextWindow) * 100)}% context usage`,
    }
}

/**
 * Preserve messages during reactive compaction.
 * Returns the messages that should be preserved after compaction.
 */
export function preserveMessages<T>(messages: T[]): T[] {
    const MAX_MESSAGES_TO_KEEP = 20
    if (messages.length <= MAX_MESSAGES_TO_KEEP) {
        return messages
    }
    return messages.slice(-MAX_MESSAGES_TO_KEEP)
}

/**
 * Try reactive compaction when a prompt-too-long or media-size error occurs.
 * Called from query.ts after detecting a 413/media error.
 *
 * Peels the oldest API-round groups from the message history and
 * runs compactConversation on the remainder, then returns the result
 * so the caller can retry the query.
 */
export async function tryReactiveCompact(params: {
    hasAttempted: boolean
    querySource?: string
    aborted: boolean
    messages: Message[]
    cacheSafeParams: CacheSafeParams & {
        systemPrompt: unknown
        userContext: unknown
        systemContext: unknown
        toolUseContext: unknown
    }
}): Promise<CompactionResult | null> {
    if (params.hasAttempted) {
        logForDebugging('[ReactiveCompact] Already attempted, skipping')
        return null
    }
    if (params.aborted) {
        logForDebugging('[ReactiveCompact] Aborted, skipping')
        return null
    }

    const { messages, cacheSafeParams } = params
    const toolUseContext = cacheSafeParams.toolUseContext as import('../../Tool.js').ToolUseContext

    logForDebugging('[ReactiveCompact] Attempting reactive compaction after prompt-too-long error')

    try {
        const result = await reactiveCompactOnPromptTooLong(
            messages,
            cacheSafeParams as CacheSafeParams,
            {
                customInstructions: undefined,
                trigger: 'auto',
            },
            toolUseContext,
        )

        if (!result.ok) {
            logForDebugging(`[ReactiveCompact] Compaction failed: ${result.reason}`)
            return null
        }

        return result.result
    } catch (err) {
        logForDebugging(`[ReactiveCompact] Error during compaction: ${err}`)
        return null
    }
}

/**
 * Result type for reactiveCompactOnPromptTooLong.
 */
type PromptTooLongOutcome =
    | { ok: true; result: CompactionResult }
    | {
          ok: false
          reason:
              | 'too_few_groups'
              | 'aborted'
              | 'exhausted'
              | 'error'
              | 'media_unstrippable'
              | 'blocked_by_hook'
      }

/**
 * Core reactive compaction logic for prompt-too-long recovery.
 *
 * Peels oldest API-round groups until the estimated context fits,
 * then runs compactConversation on the remainder.
 *
 * Also called from the /compact command in reactive-only mode.
 */
export async function reactiveCompactOnPromptTooLong(
    messages: Message[],
    cacheSafeParams: CacheSafeParams,
    options: {
        customInstructions?: string
        trigger: 'manual' | 'auto'
    },
    toolUseContext?: import('../../Tool.js').ToolUseContext,
): Promise<PromptTooLongOutcome> {
    const ctx = toolUseContext ?? cacheSafeParams.toolUseContext as import('../../Tool.js').ToolUseContext
    if (!ctx) {
        logForDebugging('[ReactiveCompact] No toolUseContext available')
        return { ok: false, reason: 'error' }
    }

    // Execute PreCompact hooks (caller may have already run these, but this
    // is the self-contained path)
    const hookResult = await executePreCompactHooks(
        {
            trigger: options.trigger,
            customInstructions: options.customInstructions ?? null,
        },
        ctx.abortController.signal,
    )
    if (hookResult.blocked) {
        logForDebugging(`[ReactiveCompact] Compaction blocked by PreCompact hook: ${hookResult.stopReason}`)
        return { ok: false, reason: 'blocked_by_hook' }
    }
    const mergedInstructions = mergeHookInstructions(
        options.customInstructions,
        hookResult.newCustomInstructions,
    )

    const groups = groupMessagesByApiRound(messages)

    // Need at least 2 groups to peel anything
    if (groups.length < 2) {
        logForDebugging('[ReactiveCompact] Too few groups to peel')
        return { ok: false, reason: 'too_few_groups' }
    }

    // Iteratively peel the oldest groups and try compaction
    let remainingGroups = groups
    for (let attempt = 0; attempt < MAX_REACTIVE_RETRIES; attempt++) {
        if (ctx.abortController.signal.aborted) {
            return { ok: false, reason: 'aborted' }
        }

        // Peel at least one group, or enough to cover the token gap
        const peelCount = Math.max(1, Math.floor(remainingGroups.length * 0.2))
        remainingGroups = remainingGroups.slice(peelCount)

        if (remainingGroups.length === 0) {
            logForDebugging('[ReactiveCompact] Exhausted all groups')
            return { ok: false, reason: 'exhausted' }
        }

        const peeledMessages = remainingGroups.flat()

        // Strip images as a last resort for media-size errors
        const messagesForCompact = stripImagesFromMessages(peeledMessages)

        try {
            const result = await compactConversation(
                messagesForCompact,
                ctx,
                {
                    ...cacheSafeParams,
                    forkContextMessages: messagesForCompact,
                },
                false,
                mergedInstructions,
                options.trigger === 'auto',
            )

            markPostCompaction()
            const activeFilePaths = new Set(
                extractReadFilesFromMessages(
                    buildPostCompactMessages(result),
                    getCwd(),
                ).keys(),
            )
            runPostCompactCleanup(undefined, activeFilePaths)
            suppressCompactWarning()

            // Execute PostCompact hooks
            const postHookResult = await executePostCompactHooks(
                ctx.abortController.signal,
            )
            if (postHookResult.userDisplayMessage) {
                result.userDisplayMessage = [
                    result.userDisplayMessage,
                    postHookResult.userDisplayMessage,
                ].filter(Boolean).join('\n')
            }

            logForDebugging(
                `[ReactiveCompact] Success on attempt ${attempt + 1}: freed ${result.preCompactTokenCount ?? 0} - ${result.postCompactTokenCount ?? 0} tokens`,
            )

            return { ok: true, result }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            if (errMsg.includes('aborted') || ctx.abortController.signal.aborted) {
                return { ok: false, reason: 'aborted' }
            }
            if (errMsg.includes(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
                return { ok: false, reason: 'too_few_groups' }
            }
            if (errMsg.includes(ERROR_MESSAGE_PROMPT_TOO_LONG)) {
                // Compact request itself hit PTL — peel more and retry
                logForDebugging(
                    `[ReactiveCompact] Compact hit PTL on attempt ${attempt + 1}, peeling more`,
                )
                continue
            }
            if (errMsg.includes(ERROR_MESSAGE_INCOMPLETE_RESPONSE)) {
                logForDebugging(
                    `[ReactiveCompact] Incomplete response on attempt ${attempt + 1}`,
                )
                return { ok: false, reason: 'error' }
            }
            // Unknown error — try again with fewer groups
            logForDebugging(
                `[ReactiveCompact] Error on attempt ${attempt + 1}: ${errMsg}`,
            )
            continue
        }
    }

    logForDebugging('[ReactiveCompact] Exhausted retries')
    return { ok: false, reason: 'exhausted' }
}
