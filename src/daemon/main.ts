/**
 * Daemon Main — 守护进程主入口
 *
 * 长时间运行的守护进程，用于管理后台工作者进程。
 * 支持 `claude daemon [subcommand]` 命令。
 *
 * gated by feature('DAEMON')
 */

import { spawn, type ChildProcess } from 'child_process'
import { logForDebugging } from '../utils/debug.js'
import { gracefulShutdownSync } from '../utils/process.js'
import { subprocessEnv } from '../utils/subprocessEnv.js'

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
    process.exit(1)
  }
}

async function startDaemon(): Promise<void> {
  console.log('Starting daemon...')

  if (daemonProcess) {
    console.log('Daemon is already running.')
    return
  }

  // Spawn worker processes
  const workerKinds = ['assistant', 'proactive', 'bg', 'cron']
  for (const kind of workerKinds) {
    spawnWorker(kind)
  }

  console.log('Daemon started with workers:', workerKinds.join(', '))
  await keepAlive()
}

async function stopDaemon(): Promise<void> {
  console.log('Stopping daemon...')
  if (daemonProcess) {
    daemonProcess.kill('SIGTERM')
    daemonProcess = null
  }
  console.log('Daemon stopped.')
  process.exit(0)
}

function checkDaemonStatus(): void {
  const running = daemonProcess !== null && !daemonProcess.killed
  console.log(`Daemon status: ${running ? 'running' : 'stopped'}`)
  process.exit(0)
}

function listWorkers(): void {
  console.log('Active workers:')
  const workerKinds = ['assistant', 'proactive', 'bg', 'cron']
  for (const kind of workerKinds) {
    console.log(`  - ${kind}`)
  }
  process.exit(0)
}

// 存储所有 worker 及其 exit 监听器，用于清理
const workers: Map<string, { process: ChildProcess; onExit: (code: number | null) => void }> = new Map()

function spawnWorker(kind: string): ChildProcess {
  const workerPath = process.argv[1] || './cli'
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