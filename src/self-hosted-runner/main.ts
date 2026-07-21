/**
 * Self-Hosted Runner — 自托管运行器
 *
 * 无头自托管运行器，用于注册到 SelfHostedRunnerWorkerService API。
 * 通过 register + poll 模式工作：注册自身，然后轮询获取任务。
 * 轮询同时也是心跳信号。
 *
 * gated by feature('SELF_HOSTED_RUNNER')
 */

import { logForDebugging } from '../utils/debug.js'

export interface RunnerConfig {
  apiUrl: string
  apiKey: string
  pollIntervalMs: number
  maxConcurrentJobs: number
  workerId?: string
}

export interface RunnerJob {
  id: string
  type: string
  payload: Record<string, unknown>
}

/**
 * Main entry point for `claude self-hosted-runner`.
 * Registers with the worker service and starts polling for jobs.
 */
export async function selfHostedRunnerMain(args: string[]): Promise<void> {
  const config = parseConfig(args)

  logForDebugging(`[SelfHostedRunner] Starting runner against ${config.apiUrl}`)

  try {
    // Register with the worker service
    const workerId = await register(config)
    logForDebugging(`[SelfHostedRunner] Registered as worker: ${workerId}`)

    // Start polling loop
    await pollLoop(config, workerId)
  } catch (error) {
    console.error(`Self-hosted runner failed: ${(error as Error).message}`)
    process.exit(1)
  }
}

function parseConfig(args: string[]): RunnerConfig {
  const apiUrl = process.env.SELF_HOSTED_API_URL || args[0] || 'http://localhost:8080'
  const apiKey = process.env.SELF_HOSTED_API_KEY || ''

  return {
    apiUrl,
    apiKey,
    pollIntervalMs: parseInt(process.env.SELF_HOSTED_POLL_INTERVAL || '5000', 10),
    maxConcurrentJobs: parseInt(process.env.SELF_HOSTED_MAX_JOBS || '1', 10),
  }
}

async function register(config: RunnerConfig): Promise<string> {
  const response = await fetch(`${config.apiUrl}/api/v1/workers/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      platform: process.platform,
      version: '2.1.87',
      maxConcurrentJobs: config.maxConcurrentJobs,
    }),
  })

  if (!response.ok) {
    throw new Error(`Registration failed: ${response.status}`)
  }

  const data = (await response.json()) as { workerId: string }
  return data.workerId
}

async function pollLoop(config: RunnerConfig, _workerId: string): Promise<void> {
  logForDebugging('[SelfHostedRunner] Starting poll loop')

  // Keep the process alive, polling for jobs
  await new Promise<void>(() => {
    const poll = async () => {
      try {
        await pollForJobs(config)
      } catch (error) {
        logForDebugging(`[SelfHostedRunner] Poll error: ${(error as Error).message}`)
      }
    }

    // Poll immediately, then on interval
    poll()
    setInterval(poll, config.pollIntervalMs)

    // Handle shutdown signals
    process.on('SIGTERM', () => {
      logForDebugging('[SelfHostedRunner] Received SIGTERM, shutting down')
      process.exit(0)
    })
    process.on('SIGINT', () => {
      logForDebugging('[SelfHostedRunner] Received SIGINT, shutting down')
      process.exit(0)
    })
  })
}

async function pollForJobs(_config: RunnerConfig): Promise<void> {
  // Poll for available jobs from the worker service
  // In the full implementation, this would:
  // 1. Send a heartbeat/poll request
  // 2. Receive any pending jobs
  // 3. Process each job
  // 4. Report results back
}