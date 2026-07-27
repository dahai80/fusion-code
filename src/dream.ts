/**
 * Dream — 梦境任务子系统
 *
 * 在后台自动执行记忆整理和知识图谱构建。
 * "梦境"是系统在空闲时自动运行的背景任务，
 * 用于整理对话历史、提取关键信息、构建长期记忆。
 *
 * 主要功能：
 * - 自动记忆整理（autoDream）
 * - 知识图谱构建
 * - 对话摘要生成
 * - 记忆关联发现
 *
 * gated by feature('KAIROS_DREAM')
 */

import { feature } from 'bun:bundle'
import { initAutoDream, isAutoDreamRunning } from './services/autoDream/autoDream.js'
import { isAutoDreamEnabled } from './services/autoDream/config.js'
import { logForDebugging } from './utils/debug.js'

export interface DreamState {
  running: boolean
  lastRunAt: number | null
  consolidationsCompleted: number
  errors: number
}

let _dreamState: DreamState = {
  running: false,
  lastRunAt: null,
  consolidationsCompleted: 0,
  errors: 0,
}

/**
 * Initialize the dream system.
 * Called during startup to set up background memory consolidation.
 */
export function initDream(): void {
  if (!feature('KAIROS_DREAM')) return

  logForDebugging('[Dream] Initializing dream subsystem')

  if (isAutoDreamEnabled()) {
    initAutoDream()
    _dreamState.running = true
    logForDebugging('[Dream] Auto-dream initialized')
  }
}

/**
 * Start a dream cycle manually.
 * Triggers memory consolidation and knowledge graph building.
 */
export async function startDreamCycle(): Promise<DreamState> {
  if (!feature('KAIROS_DREAM')) {
    return { ..._dreamState, running: false }
  }

  logForDebugging('[Dream] Starting manual dream cycle')
  _dreamState.running = true
  _dreamState.lastRunAt = Date.now()

  try {
    if (isAutoDreamEnabled()) {
      // In the full implementation, this would:
      // 1. Process recent conversation history
      // 2. Extract key information and patterns
      // 3. Build/update knowledge graph entries
      // 4. Consolidate memories
      // 5. Discover new associations
      _dreamState.consolidationsCompleted++
    }
  } catch (error) {
    _dreamState.errors++
    logForDebugging(`[Dream] Dream cycle error: ${(error as Error).message}`)
  } finally {
    _dreamState.running = false
  }

  return { ..._dreamState }
}

/**
 * Get the current dream state.
 */
export function getDreamState(): DreamState {
  return { ..._dreamState }
}

/**
 * Check if dream is currently running.
 */
export function isDreamRunning(): boolean {
  if (!feature('KAIROS_DREAM')) return false
  return _dreamState.running || isAutoDreamRunning()
}

/**
 * Schedule a dream cycle for a specific time.
 */
export function scheduleDream(delayMs: number): void {
  if (!feature('KAIROS_DREAM')) return

  setTimeout(async () => {
    await startDreamCycle()
  }, delayMs)

  logForDebugging(`[Dream] Dream scheduled in ${delayMs}ms`)
}

/**
 * Stop the dream system.
 */
export function stopDream(): void {
  _dreamState.running = false
  logForDebugging('[Dream] Dream system stopped')
}