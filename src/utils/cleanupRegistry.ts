/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

import { logForDebugging } from './debug.js'

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

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
 * Used internally by gracefulShutdown.
 */
export async function runCleanupFunctions(): Promise<void> {
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
