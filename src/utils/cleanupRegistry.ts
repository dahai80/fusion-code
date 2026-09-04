/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

import { logForDebugging } from './debug.js'

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

// audit 0905 E4: run-once guard。SIGINT + gracefulShutdown 竞态会触发 runCleanupFunctions
// 两次 → cleanup 回调重复执行 (重复 kill 已 kill task、重复 flush)。Set 已保证单回调
// 不重复注册, 但 run 本身需幂等。ran=true 后再次 run 直接返回 (已清理)。
let cleanupRan = false

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown. Idempotent (audit 0905 E4): safe to
 * call multiple times under shutdown race; runs at most once.
 */
export async function runCleanupFunctions(): Promise<void> {
  if (cleanupRan) {
    logForDebugging(
      'runCleanupFunctions: already ran (shutdown race), skipping duplicate run',
    )
    return
  }
  cleanupRan = true
  const results = await Promise.allSettled(
    Array.from(cleanupFunctions).map(fn => fn()),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      logForDebugging(
        `runCleanupFunctions: cleanup function rejected: ${result.reason}`,
        { level: 'warn' },
      )
    }
  }
}
