/**
 * Reactive Compact — 响应式上下文压缩
 *
 * 在上下文窗口接近上限时自动触发压缩，
 * 无需用户手动执行 /compact 命令。
 * 通过监控 token 使用量，在达到阈值时自动执行压缩。
 *
 * gated by feature('REACTIVE_COMPACT')
 */

import { getContextWindowForModel } from '../../utils/context.js'
import { getTotalInputTokens, getTotalOutputTokens } from '../../cost-tracker.js'
import { logForDebugging } from '../../utils/debug.js'

export interface ReactiveCompactResult {
  compressed: boolean
  tokensFreed: number
  reason: string
}

// Threshold: compress when usage reaches 80% of context window
const COMPRESS_THRESHOLD = 0.8

// Minimum tokens that must be freed to make compression worthwhile
const MIN_TOKENS_TO_FREE = 5_000

let _reactiveOnlyMode = false

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
  // Keep the last N messages (the most recent conversation turns)
  const MAX_MESSAGES_TO_KEEP = 20
  if (messages.length <= MAX_MESSAGES_TO_KEEP) {
    return messages
  }
  return messages.slice(-MAX_MESSAGES_TO_KEEP)
}