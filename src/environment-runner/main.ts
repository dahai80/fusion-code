/**
 * BYOC Environment Runner — 自托管环境运行器
 *
 * 在 BYOC（Bring Your Own Cloud）环境中运行 Fusion-Code 工作负载。
 * 这是一个无头运行器，连接到 Environment Manager 服务，
 * 接收任务、执行工作负载、上报结果。
 *
 * 工作流程：
 * 1. 注册到 Environment Manager
 * 2. 轮询获取任务
 * 3. 执行任务（运行 Fusion-Code 工作负载）
 * 4. 上报结果
 * 5. 心跳保活
 *
 * gated by feature('BYOC_ENVIRONMENT_RUNNER')
 */

import { spawn } from 'child_process'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'

export interface RunnerOptions {
  /** Environment Manager API URL */
  apiUrl: string
  /** Runner authentication token */
  authToken?: string
  /** Runner version string */
  runnerVersion: string
  /** Poll interval in ms */
  pollIntervalMs: number
  /** Max concurrent environments */
  maxConcurrent: number
}

export interface EnvironmentTask {
  id: string
  type: 'session' | 'batch' | 'eval'
  payload: Record<string, unknown>
  environmentId: string
}

/**
 * Main entry point for `claude environment-runner`.
 * Called from the CLI fast-path in cli.tsx.
 */
export async function environmentRunnerMain(args: string[]): Promise<void> {
  const options = parseOptions(args)

  logForDebugging(`[BYOC] Starting environment runner against ${options.apiUrl}`)
  process.env.FUSION_CODE_ENVIRONMENT_RUNNER_VERSION = options.runnerVersion

  try {
    // Register with the Environment Manager
    const runnerId = await registerRunner(options)
    logForDebugging(`[BYOC] Registered as runner: ${runnerId}`)

    // Start the main loop: poll → execute → report
    await mainLoop(options, runnerId)
  } catch (error) {
    console.error(`Environment runner failed: ${(error as Error).message}`)
    process.exit(1)
  }
}

function parseOptions(_args: string[]): RunnerOptions {
  return {
    apiUrl: process.env.ENVIRONMENT_MANAGER_URL || 'http://localhost:8080',
    authToken: process.env.ENVIRONMENT_MANAGER_AUTH_TOKEN,
    runnerVersion: process.env.FUSION_CODE_ENVIRONMENT_RUNNER_VERSION || '2.1.87',
    pollIntervalMs: parseInt(process.env.BYOC_POLL_INTERVAL || '10000', 10),
    maxConcurrent: parseInt(process.env.BYOC_MAX_CONCURRENT || '2', 10),
  }
}

async function registerRunner(options: RunnerOptions): Promise<string> {
  const response = await fetch(`${options.apiUrl}/api/v1/runners/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify({
      version: options.runnerVersion,
      platform: process.platform,
      maxConcurrent: options.maxConcurrent,
      capabilities: ['session', 'batch'],
    }),
  })

  if (!response.ok) {
    throw new Error(`Runner registration failed: ${response.status}`)
  }

  const data = (await response.json()) as { runnerId: string }
  return data.runnerId
}

async function mainLoop(options: RunnerOptions, runnerId: string): Promise<void> {
  logForDebugging('[BYOC] Starting main loop')

  // Heartbeat interval
  const heartbeatInterval = setInterval(async () => {
    try {
      await sendHeartbeat(options, runnerId)
    } catch (error) {
      logForDebugging(`[BYOC] Heartbeat failed: ${(error as Error).message}`)
    }
  }, options.pollIntervalMs)
  heartbeatInterval.unref()

  // Poll for tasks
  const pollInterval = setInterval(async () => {
    try {
      await pollAndExecute(options, runnerId)
    } catch (error) {
      logForDebugging(`[BYOC] Poll failed: ${(error as Error).message}`)
    }
  }, options.pollIntervalMs)
  pollInterval.unref()

  // First poll immediately
  await pollAndExecute(options, runnerId)

  // Keep alive until signal
  await new Promise<void>(() => {
    process.on('SIGTERM', () => {
      logForDebugging('[BYOC] Received SIGTERM, shutting down')
      clearInterval(heartbeatInterval)
      clearInterval(pollInterval)
      process.exit(0)
    })
    process.on('SIGINT', () => {
      logForDebugging('[BYOC] Received SIGINT, shutting down')
      clearInterval(heartbeatInterval)
      clearInterval(pollInterval)
      process.exit(0)
    })
  })
}

async function sendHeartbeat(options: RunnerOptions, runnerId: string): Promise<void> {
  await fetch(`${options.apiUrl}/api/v1/runners/${runnerId}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify({ status: 'running', ts: Date.now() }),
  })
}

async function pollAndExecute(options: RunnerOptions, runnerId: string): Promise<void> {
  const response = await fetch(
    `${options.apiUrl}/api/v1/runners/${runnerId}/tasks`,
    {
      method: 'GET',
      headers: {
        ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
      },
    },
  )

  if (!response.ok) return

  const data = (await response.json()) as { tasks: EnvironmentTask[] }
  if (!data.tasks?.length) return

  for (const task of data.tasks) {
    logForDebugging(`[BYOC] Executing task: ${task.id} (${task.type})`)
    try {
      await executeTaskWithRetry(task, options, 3)
      await reportTaskComplete(options, runnerId, task.id)
    } catch (error) {
      logError(error)
      await reportTaskFailed(options, runnerId, task.id, (error as Error).message)
    }
  }
}

/**
 * 执行任务并支持自动重试
 */
async function executeTaskWithRetry(
  task: EnvironmentTask,
  options: RunnerOptions,
  maxRetries: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await executeTask(task, options)
      return // 成功则退出
    } catch (error) {
      if (attempt < maxRetries) {
        logForDebugging(`[BYOC] Task ${task.id} attempt ${attempt} failed, retrying...`)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      } else {
        throw error // 最后一次失败则向上抛出
      }
    }
  }
}

async function executeTask(task: EnvironmentTask, _options: RunnerOptions): Promise<void> {
  const cliPath = process.argv[1] || './cli'

  return new Promise((resolve, reject) => {
    const args = [cliPath]
    if (task.type === 'session' && task.payload.sessionPrompt) {
      args.push('-p', String(task.payload.sessionPrompt))
    }

    const child = spawn(
      cliPath.endsWith('.tsx') ? 'bun' : cliPath,
      args,
      {
        stdio: 'pipe',
        env: {
          ...process.env,
          FUSION_CODE_ENVIRONMENT_TASK_ID: task.id,
          FUSION_CODE_ENVIRONMENT_ID: task.environmentId,
        },
      },
    )

    child.on('close', (code) => {
      logForDebugging(`[BYOC] Task ${task.id} completed with code ${code}`)
      resolve()
    })

    child.on('error', (err) => {
      reject(err)
    })

    // Timeout after 30 minutes
    setTimeout(() => {
      child.kill('SIGTERM')
      resolve()
    }, 30 * 60 * 1000)
  })
}

async function reportTaskComplete(
  options: RunnerOptions,
  runnerId: string,
  taskId: string,
): Promise<void> {
  await fetch(`${options.apiUrl}/api/v1/runners/${runnerId}/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify({ status: 'completed', ts: Date.now() }),
  })
}

async function reportTaskFailed(
  options: RunnerOptions,
  runnerId: string,
  taskId: string,
  error: string,
): Promise<void> {
  await fetch(`${options.apiUrl}/api/v1/runners/${runnerId}/tasks/${taskId}/failed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify({ status: 'failed', error, ts: Date.now() }),
  })
}