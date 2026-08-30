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

export interface WorkerKindSpec {
  kind: WorkerKind
  // audit 1.2.1: only spawn workers that have a REAL implementation. All four
  // kinds are currently no-op stubs (keepAlive() only) — eagerly spawning them
  // burns ~80-200MB RSS × 4 for zero work (the audit's "幻影 daemon"). Flip to
  // true when a worker body gets real logic; until then startDaemon spawns
  // zero workers = zero phantom RSS.
  implemented: boolean
}

// audit 1.2.1: single-source worker-kind registry. startDaemon + listWorkers
// both read this so spawn-set and report-set never drift.
export const WORKER_KINDS: readonly WorkerKindSpec[] = [
  { kind: 'assistant', implemented: false },
  { kind: 'proactive', implemented: false },
  { kind: 'bg', implemented: false },
  { kind: 'cron', implemented: false },
]

// audit 1.2.1: pure helper — kinds safe to spawn (have real bodies). startDaemon
// iterates this; today returns [] (all stubs) → no eager no-op processes.
export function getImplementedWorkerKinds(): WorkerKind[] {
  return WORKER_KINDS.filter(w => w.implemented).map(w => w.kind)
}

// audit 2.1.5: if the supervisor is SIGKILL'd / OOM-killed, cleanupWorkers
// never runs and this worker is orphaned forever (macOS has no
// PR_SET_PDEATHSIG). Poll the parent pid — kill(ppid, 0) throws ESRCH once the
// parent is gone → self-exit. Standard portable parent-death watch.
function watchParentAndExit(): NodeJS.Timeout {
  const ppid = process.ppid
  return setInterval(() => {
    try {
      process.kill(ppid, 0)
    } catch (err) {
      // ESRCH = parent gone → self-exit. EPERM (pid recycled to a process we
      // can't signal) is rare with a 5s poll; log + ignore, don't wrongly exit.
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        logForDebugging('[Daemon] Worker parent process gone; self-exiting')
        process.exit(0)
      }
    }
  }, 5000)
}

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
  // audit 2.1.5: arm the parent-death watcher so a SIGKILL'd supervisor can't
  // orphan this worker. Cleared on signal exit to avoid a dangling timer.
  const parentWatcher = watchParentAndExit()
  return new Promise(() => {
    // Keep running until SIGTERM/SIGINT
    process.on('SIGTERM', () => {
      clearInterval(parentWatcher)
      logForDebugging('[Daemon] Worker received SIGTERM, shutting down')
      process.exit(0)
    })
    process.on('SIGINT', () => {
      clearInterval(parentWatcher)
      logForDebugging('[Daemon] Worker received SIGINT, shutting down')
      process.exit(0)
    })
  })
}