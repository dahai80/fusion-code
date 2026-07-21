/**
 * Proactive Mode — 主动模式
 *
 * 在主动模式下，AI 模型无需等待用户指令即可主动采取行动。
 * 系统会定期发送 <tick> 提示，AI 可以自主决定做什么。
 * 使用 SleepTool 在无事可做时休眠。
 *
 * 主要功能：
 * - 主动模式激活/停用
 * - Tick 调度
 * - 暂停/恢复
 * - 系统提示词扩展
 *
 * gated by feature('PROACTIVE') or feature('KAIROS')
 */

import { feature } from 'bun:bundle'
import { isEnvTruthy } from '../utils/envUtils.js'
import { logForDebugging } from '../utils/debug.js'

let _proactiveActive = false
let _proactivePaused = false
let _activationSource: string | undefined
let _tickInterval: ReturnType<typeof setInterval> | undefined
let _lastTickAt: number | null = null

/**
 * Check if proactive mode is currently active.
 */
export function isProactiveActive(): boolean {
  if (!(feature('PROACTIVE') || feature('KAIROS'))) return false
  return _proactiveActive
}

/**
 * Check if proactive mode is paused.
 * When paused, ticks are suppressed but the mode remains active.
 */
export function isProactivePaused(): boolean {
  return _proactivePaused
}

/**
 * Activate proactive mode.
 * @param source The source of activation: 'command', 'env', 'startup'
 */
export function activateProactive(source: string = 'command'): void {
  if (!(feature('PROACTIVE') || feature('KAIROS'))) return

  _proactiveActive = true
  _proactivePaused = false
  _activationSource = source
  _lastTickAt = Date.now()

  logForDebugging(`[Proactive] Activated from: ${source}`)

  // Start sending ticks
  startTickScheduler()
}

/**
 * Deactivate proactive mode.
 */
export function deactivateProactive(): void {
  _proactiveActive = false
  _proactivePaused = false
  _activationSource = undefined

  stopTickScheduler()
  logForDebugging('[Proactive] Deactivated')
}

/**
 * Pause proactive mode temporarily.
 */
export function pauseProactive(): void {
  _proactivePaused = true
  stopTickScheduler()
  logForDebugging('[Proactive] Paused')
}

/**
 * Resume proactive mode after pause.
 */
export function resumeProactive(): void {
  if (!_proactiveActive) return
  _proactivePaused = false
  _lastTickAt = Date.now()
  startTickScheduler()
  logForDebugging('[Proactive] Resumed')
}

/**
 * Get the proactive system prompt section.
 * Appended to the base system prompt when proactive is active.
 */
export function getProactiveSection(): string | null {
  if (!isProactiveActive()) return null

  return `# Autonomous work

You are in proactive mode. Take initiative — explore, act, and make progress without waiting for instructions.

Start by briefly greeting the user.

You will receive periodic <tick> prompts. These are check-ins. Do whatever seems most useful, or call Sleep if there's nothing to do.`
}

/**
 * Check if FUSION_CODE_PROACTIVE env var is set and trigger activation.
 * Called during startup to auto-activate proactive mode.
 */
export function maybeActivateFromEnv(): void {
  if (_proactiveActive) return
  if (isEnvTruthy(process.env.FUSION_CODE_PROACTIVE)) {
    activateProactive('env')
  }
}

/**
 * Record the last tick time.
 */
export function recordTick(): void {
  _lastTickAt = Date.now()
}

/**
 * Get the time since the last tick in ms.
 */
export function timeSinceLastTick(): number {
  if (!_lastTickAt) return Infinity
  return Date.now() - _lastTickAt
}

/**
 * Get the tick interval in ms.
 * Default: 30000ms (30 seconds), configurable via env var.
 */
export function getTickIntervalMs(): number {
  return parseInt(process.env.FUSION_CODE_PROACTIVE_TICK_INTERVAL || '30000', 10)
}

/**
 * Get the activation source.
 */
export function getActivationSource(): string | undefined {
  return _activationSource
}

/**
 * Get the proactive state for debugging.
 */
export function getProactiveState(): {
  active: boolean
  paused: boolean
  source: string | undefined
  lastTickAt: number | null
  tickIntervalMs: number
} {
  return {
    active: _proactiveActive,
    paused: _proactivePaused,
    source: _activationSource,
    lastTickAt: _lastTickAt,
    tickIntervalMs: getTickIntervalMs(),
  }
}

// ─── Internal ───────────────────────────────────────────────

function startTickScheduler(): void {
  stopTickScheduler()
  const intervalMs = getTickIntervalMs()
  _tickInterval = setInterval(() => {
    if (_proactiveActive && !_proactivePaused) {
      _lastTickAt = Date.now()
      logForDebugging('[Proactive] Tick')
    }
  }, intervalMs)
  if (_tickInterval) {
    _tickInterval.unref()
  }
}

function stopTickScheduler(): void {
  if (_tickInterval) {
    clearInterval(_tickInterval)
    _tickInterval = undefined
  }
}