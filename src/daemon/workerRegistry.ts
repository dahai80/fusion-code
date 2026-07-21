/**
 * Worker Registry — 守护进程工作注册表
 *
 * 管理守护进程的工作者（workers）。
 * 支持 `--daemon-worker=<kind>` 快速路径启动特定工作者。
 *
 * gated by feature('DAEMON')
 */

import { logForDebugging } from '../utils/debug.js'

export type WorkerKind = 'assistant' | 'proactive' | 'bg' | 'cron'

/**
 * Run a daemon worker process.
 * Called from the CLI fast-path when `--daemon-worker=<kind>` is passed.
 * Each worker kind has its own lifecycle and responsibilities.
 */
export async function runDaemonWorker(kind: string | undefined): Promise<void> {
  logForDebugging(`[Daemon] Starting worker: ${kind}`)

  switch (kind) {
    case 'assistant':
      await runAssistantWorker()
      break
    case 'proactive':
      await runProactiveWorker()
      break
    case 'bg':
      await runBgWorker()
      break
    case 'cron':
      await runCronWorker()
      break
    default:
      console.error(`Unknown worker kind: ${kind}`)
      process.exit(1)
  }
}

async function runAssistantWorker(): Promise<void> {
  // Assistant worker: handles background assistant tasks
  logForDebugging('[Daemon] Assistant worker started')
  // In the full implementation, this would:
  // 1. Connect to the daemon's IPC channel
  // 2. Listen for assistant task requests
  // 3. Process tasks and return results
  await keepAlive()
}

async function runProactiveWorker(): Promise<void> {
  // Proactive worker: handles proactive suggestion tasks
  logForDebugging('[Daemon] Proactive worker started')
  await keepAlive()
}

async function runBgWorker(): Promise<void> {
  // Background worker: handles background session tasks
  logForDebugging('[Daemon] Background worker started')
  await keepAlive()
}

async function runCronWorker(): Promise<void> {
  // Cron worker: handles scheduled trigger tasks
  logForDebugging('[Daemon] Cron worker started')
  await keepAlive()
}

/**
 * Keep the worker process alive until a termination signal is received.
 */
async function keepAlive(): Promise<void> {
  return new Promise(() => {
    // Keep running until SIGTERM/SIGINT
    process.on('SIGTERM', () => {
      logForDebugging('[Daemon] Worker received SIGTERM, shutting down')
      process.exit(0)
    })
    process.on('SIGINT', () => {
      logForDebugging('[Daemon] Worker received SIGINT, shutting down')
      process.exit(0)
    })
  })
}