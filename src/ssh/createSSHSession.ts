/**
 * SSH Remote Session — SSH 远程会话
 *
 * 允许 fusion-code 通过 SSH 连接到远程主机，
 * 在远程主机上运行工具，同时在本地渲染 UI。
 *
 * 认证通过本地 Unix socket 代理转发，无需在远程存储 API 密钥。
 *
 * gated by feature('SSH_REMOTE')
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { unlinkSync } from 'fs'
import { logForDebugging } from '../utils/debug.js'
import { startAuthProxy } from './sshAuthProxy.js'
import { getAnthropicApiKey } from '../utils/auth.js'
import type { SSHSessionManager } from './SSHSessionManager.js'
import type { SDKMessage } from '../entrypoints/sdk/coreTypes.generated.js'
import type { SDKControlPermissionRequest } from '../entrypoints/sdk/controlTypes.js'

export class SSHSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SSHSessionError'
  }
}

export interface SSHSessionConfig {
  host: string
  cwd?: string
  localVersion: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
  onProgress?: (message: string) => void
}

export interface LocalSSHSessionConfig {
  cwd?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
}

export interface SSHSession {
  remoteCwd: string
  process: ChildProcess
  cleanup: () => Promise<void>
  createManager: (callbacks: {
    onMessage: (msg: SDKMessage) => void
    onPermissionRequest: (request: SDKControlPermissionRequest, requestId: string) => void
    onConnected: () => void
    onReconnecting: (attempt: number, max: number) => void
    onDisconnected: () => void
    onError: (error: Error) => void
  }) => SSHSessionManager // log: fix TS2339
  getStderrTail: () => string // log: fix TS2339
  proc: ChildProcess // log: fix TS2339
  proxy: { stop: () => void } // log: fix TS2339
}

export interface SSHSessionType {
  remoteCwd: string
  process: ChildProcess
  cleanup: () => Promise<void>
}

/**
 * Create an SSH session to a remote host.
 * Deploys the binary, starts an auth proxy, and spawns the remote CLI.
 */
export async function createSSHSession(
  config: SSHSessionConfig,
): Promise<SSHSession> {
  const { host, cwd, localVersion, permissionMode, dangerouslySkipPermissions, onProgress } = config

  // 防止主机名注入攻击：只允许合法的主机名格式
  if (!isValidHostname(host)) {
    throw new SSHSessionError(
      `Invalid hostname format: ${host}`,
    )
  }

  const reportProgress = (msg: string) => {
    logForDebugging(`[SSH] ${msg}`)
    onProgress?.(msg)
  }

  reportProgress(`Connecting to ${host}...`)

  // 1. Check if the remote host is reachable
  try {
    await execRemoteCommand(host, 'echo "connected"')
  } catch (error) {
    throw new SSHSessionError(
      `Cannot connect to ${host}: ${(error as Error).message}`,
    )
  }
  reportProgress('Connected')

  // 2. Get the API key for the auth proxy
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new SSHSessionError(
      'No API key available. Set FUSION_API_KEY or login first.',
    )
  }

  // 3. Start the local auth proxy
  const socketPath = join(tmpdir(), `fusion-ssh-${randomUUID()}.sock`)
  const authProxy = await startAuthProxy({
    socketPath,
    apiKey,
  })
  reportProgress(`Auth proxy started on ${socketPath}`)

  // 4. Determine remote cwd
  let remoteCwd = cwd || ''
  if (!remoteCwd) {
    try {
      remoteCwd = await execRemoteCommand(host, 'pwd')
    } catch {
      remoteCwd = '/home'
    }
  }
  reportProgress(`Remote working directory: ${remoteCwd}`)

  // 5. Build the remote command
  const remoteEnv = [
    `FUSION_UNIX_SOCKET=${socketPath}`,
    `FUSION_CODE_OAUTH_TOKEN=placeholder`,
    `FUSION_CODE_REMOTE=1`,
    `FUSION_CODE_ENTRYPOINT=sdk-cli`,
  ].join(' ')

  const permissionArgs = permissionMode
    ? ` --permission-mode ${permissionMode}`
    : ''
  const skipPermissionsArgs = dangerouslySkipPermissions
    ? ' --dangerously-skip-permissions'
    : ''

  const remoteCmd = `cd ${remoteCwd} && ${remoteEnv} fusion-code${permissionArgs}${skipPermissionsArgs}`

  // 6. Spawn the SSH process
  const sshArgs = [
    '-t', // Force pseudo-terminal allocation
    '-R', `${socketPath}:${socketPath}`, // Forward the auth socket
    host,
    remoteCmd,
  ]

  reportProgress('Spawning remote session...')
  const sshProcess = spawn('ssh', sshArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FUSION_UNIX_SOCKET: socketPath,
    },
  })

  sshProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString()
    logForDebugging(`[SSH stderr] ${msg}`)
  })

  return {
    remoteCwd,
    process: sshProcess,
    cleanup: async () => {
      sshProcess.kill()
      await authProxy.stop()
      try {
        unlinkSync(socketPath)
      } catch {
        // Socket file may already be gone
      }
    },
    createManager: () => {
      throw new SSHSessionError('createManager not implemented for remote SSH session')
    },
    getStderrTail: () => '',
    proc: sshProcess,
    proxy: authProxy,
  }
}

/**
 * Create a local SSH session for testing.
 * Spawns the CLI locally with the auth proxy plumbing.
 */
export function createLocalSSHSession(
  config: LocalSSHSessionConfig,
): SSHSession {
  const { cwd, permissionMode, dangerouslySkipPermissions } = config
  const remoteCwd = cwd || process.cwd()

  const permissionArgs = permissionMode
    ? ` --permission-mode ${permissionMode}`
    : ''
  const skipPermissionsArgs = dangerouslySkipPermissions
    ? ' --dangerously-skip-permissions'
    : ''

  const cliPath = process.argv[1] || './cli'
  const args = [
    ...(cliPath.endsWith('.tsx') ? ['run', cliPath] : [cliPath]),
    ...(permissionArgs ? permissionArgs.trim().split(' ') : []),
    ...(skipPermissionsArgs ? skipPermissionsArgs.trim().split(' ') : []),
  ]

  const childProcess = spawn(
    cliPath.endsWith('.tsx') ? 'bun' : cliPath,
    args,
    {
      cwd: remoteCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FUSION_CODE_REMOTE: '1',
        FUSION_CODE_ENTRYPOINT: 'sdk-cli',
      },
    },
  )

  return {
    remoteCwd,
    process: childProcess,
    cleanup: async () => {
      childProcess.kill()
    },
    createManager: () => {
      throw new SSHSessionError('createManager not implemented for local SSH session')
    },
    getStderrTail: () => '',
    proc: childProcess,
    proxy: { stop: () => {} },
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Execute a command on a remote host via SSH and return the stdout.
 */
async function execRemoteCommand(
  host: string,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', [host, command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || `Exit code ${code}`))
      }
    })

    proc.on('error', (err: Error) => {
      reject(err)
    })
  })
}

/**
 * 验证主机名格式：只允许合法的域名、IP 地址或 localhost
 */
function isValidHostname(host: string): boolean {
  // 只允许字母、数字、点、连字符、下划线、冒号（IPv6）、@（用户）
  // 不允许空格、引号、分号、管道符、美元符号、反引号等 shell 特殊字符
  return /^[a-zA-Z0-9._:@\-\[\]]+$/.test(host) && host.length > 0 && host.length <= 255
}