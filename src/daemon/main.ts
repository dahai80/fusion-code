/**
 * Daemon Main — 守护进程主入口
 *
 * 长时间运行的守护进程，用于管理后台工作者进程。
 * 支持 `claude daemon [subcommand]` 命令。
 *
 * gated by feature('DAEMON')
 */

import { spawn, type ChildProcess } from 'child_process'
import { statSync } from 'fs'
import { resolve } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { gracefulShutdownSync } from '../utils/process.js'
import { subprocessEnv } from '../utils/subprocessEnv.js'
// P3-20: process.exit 直跳过注册的 cleanup (init.ts:18 registerCleanup 注册的
// analytics flush / LSP 关停等)。退出前先跑 runCleanupFunctions + cleanupWorkers。
import { runCleanupFunctions } from '../utils/cleanupRegistry.js'
import {
  WORKER_KINDS,
  getImplementedWorkerKinds,
} from './workerRegistry.js'

// P3-21: 允许的 worker 脚本后缀 (仅脚本文件, 非任意可执行)。
const WORKER_PATH_ALLOWED_EXT = ['.js', '.mjs', '.cjs', '.tsx', '.ts']

// audit 1.2.2/2.1.1: bound the worker pool. Current startDaemon spawns a fixed
// 4 with no respawn, so the cap never fires today — but a future respawn-on-
// exit path could unboundedly spawn (audit's 200-subprocess / OOM-killer
// scenario). Cap is env-overridable for legit large pools; default 16.
const MAX_DAEMON_WORKERS = Number.isFinite(
  parseInt(process.env.FUSION_CODE_MAX_DAEMON_WORKERS ?? '', 10),
)
  ? parseInt(process.env.FUSION_CODE_MAX_DAEMON_WORKERS ?? '', 10)
  : 16

// P3-21: 校验 workerPath — 绝对化 + 后缀白名单 + 文件存在。返回安全绝对路径或 null。
function resolveWorkerPath(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  const abs = resolve(raw)
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase()
  if (!WORKER_PATH_ALLOWED_EXT.includes(ext)) return null
  try {
    const st = statSync(abs)
    if (!st.isFile()) return null
  } catch {
    return null
  }
  return abs
}

export interface DaemonSubcommand {
  name: string
  description: string
  run: (args: string[]) => Promise<void>
}

const SUBCOMMANDS: DaemonSubcommand[] = [
  {
    name: 'start',
    description: 'Start the daemon',
    run: async () => {
      await startDaemon()
    },
  },
  {
    name: 'stop',
    description: 'Stop the daemon',
    run: async () => {
      await stopDaemon()
    },
  },
  {
    name: 'status',
    description: 'Check daemon status',
    run: async () => {
      checkDaemonStatus()
    },
  },
  {
    name: 'workers',
    description: 'List active workers',
    run: async () => {
      listWorkers()
    },
  },
]

let daemonProcess: ChildProcess | null = null

/**
 * Main entry point for `claude daemon [subcommand]`.
 */
export async function daemonMain(args: string[]): Promise<void> {
  const subcommand = args[0]?.toLowerCase() || 'status'

  const cmd = SUBCOMMANDS.find(s => s.name === subcommand)
  if (cmd) {
    logForDebugging(`[Daemon] Running subcommand: ${subcommand}`)
    await cmd.run(args.slice(1))
  } else {
    console.log(`Unknown daemon subcommand: ${subcommand}`)
    console.log('Usage: claude daemon <start|stop|status|workers>')
    // P3-20: 走 exitDaemon 跑 cleanup, 非裸 process.exit。
    await exitDaemon(1)
  }
}

async function startDaemon(): Promise<void> {
  console.log('Starting daemon...')

  if (daemonProcess) {
    console.log('Daemon is already running.')
    return
  }

  // audit 1.2.1: spawn only workers with a real implementation. All four
  // kinds are no-op stubs today → spawns none → no phantom-RSS processes.
  // listWorkers still reports all registered kinds (status, not liveness).
  const kinds = getImplementedWorkerKinds()
  for (const kind of kinds) {
    spawnWorker(kind)
  }
  if (kinds.length === 0) {
    logForDebugging('[Daemon] No implemented workers; supervisor idle (stubs pending)')
  }

  console.log(`Daemon started with workers: ${kinds.join(', ') || '(none — stubs pending)'}`)
  await keepAlive()
}

async function stopDaemon(): Promise<void> {
  console.log('Stopping daemon...')
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM')
    daemonProcess = null
  }
  console.log('Daemon stopped.')
  // P3-20: 走 exitDaemon 跑 cleanup, 非裸 process.exit。
  await exitDaemon(0)
}

async function checkDaemonStatus(): Promise<void> {
  const running = daemonProcess !== null && !daemonProcess.killed
  console.log(`Daemon status: ${running ? 'running' : 'stopped'}`)
  // P3-20: 走 exitDaemon 跑 cleanup, 非裸 process.exit。
  await exitDaemon(0)
}

async function listWorkers(): Promise<void> {
  console.log('Active workers:')
  // audit 1.2.1: single-source — report all registered kinds (status, not
  // liveness), independent of the implemented-only spawn set.
  const workerKinds = WORKER_KINDS.map(w => w.kind)
  for (const kind of workerKinds) {
    console.log(`  - ${kind}`)
  }
  // P3-20: 走 exitDaemon 跑 cleanup, 非裸 process.exit。
  await exitDaemon(0)
}

// 存储所有 worker 及其 exit 监听器，用于清理
const workers: Map<string, { process: ChildProcess; onExit: (code: number | null) => void }> = new Map()

function spawnWorker(kind: string): ChildProcess {
  // audit 1.2.2/2.1.1: pool bound — a future respawn-on-exit path can't
  // unboundedly spawn. Fail-closed dummy (same pattern as the workerPath-
  // rejected branch below) when the cap is hit. Never fires today (fixed-4
  // spawn, no respawn), defense-in-depth.
  if (workers.size >= MAX_DAEMON_WORKERS) {
    logForDebugging(
      `[Daemon] Worker cap reached (${MAX_DAEMON_WORKERS}); not spawning "${kind}"`,
    )
    const dummy = spawn('true', [], { stdio: 'ignore' })
    return dummy
  }

  // P3-21: process.argv[1] 攻击者可经 exec 参数控制; 未校验直 spawn 该路径为命令
  // = RCE 原语 (daemon fast-path 在 cli.tsx auth 前跑)。校验: 仅接 .js/.tsx/.mjs/.cjs
  // 后缀 + 必须能 resolve 为绝对路径 (path.resolve), 拒绝裸命令名/相对穿越/非脚本。
  // 不在白名单列固定名 (因 build 产物路径可变), 改用后缀 + 绝对化 + 存在性约束。
  const rawWorkerPath = process.argv[1] || './cli'
  const workerPath = resolveWorkerPath(rawWorkerPath)
  if (!workerPath) {
    logForDebugging(
      `[Daemon] Refusing to spawn worker "${kind}": workerPath rejected (raw="${rawWorkerPath}")`,
    )
    // Fail-closed: 返回一个已退出的哑进程占位, 不 spawn 攻击者路径。
    const dummy = spawn('true', [], { stdio: 'ignore' })
    return dummy
  }
  const args = workerPath.endsWith('.tsx')
    ? ['run', workerPath, '--daemon-worker', kind]
    : [workerPath, '--daemon-worker', kind]

  const worker = spawn(
    workerPath.endsWith('.tsx') ? 'bun' : workerPath,
    args,
    {
      stdio: 'inherit',
      env: subprocessEnv(),
    },
  )

  const onExit = (code: number | null) => {
    logForDebugging(`[Daemon] Worker ${kind} exited with code ${code}`)
    workers.delete(kind)
  }

  worker.on('exit', onExit)
  workers.set(kind, { process: worker, onExit })

  daemonProcess = worker
  return worker
}

function cleanupWorkers(): void {
  for (const [kind, { process: worker, onExit }] of workers) {
    worker.off('exit', onExit)
    worker.kill('SIGTERM')
    logForDebugging(`[Daemon] Cleaned up worker: ${kind}`)
  }
  workers.clear()
  daemonProcess = null
}

// P3-20: 统一退出路径 — 跑注册的 cleanup (runCleanupFunctions, analytics flush 等)
// + kill 残留 worker, 再 process.exit。原各处 process.exit 直跳过 cleanup。
async function exitDaemon(code: number): Promise<void> {
  try {
    cleanupWorkers()
    await runCleanupFunctions()
  } catch (err) {
    logForDebugging(`[Daemon] exitDaemon cleanup failed: ${(err as Error).message}`)
  }
  process.exit(code)
}

async function keepAlive(): Promise<void> {
  return new Promise(() => {
    process.on('SIGTERM', () => {
      logForDebugging('[Daemon] Received SIGTERM, shutting down')
      cleanupWorkers()
      gracefulShutdownSync(0)
    })
    process.on('SIGINT', () => {
      logForDebugging('[Daemon] Received SIGINT, shutting down')
      cleanupWorkers()
      gracefulShutdownSync(0)
    })
  })
}