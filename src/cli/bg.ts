/**
 * BG Sessions — 后台会话管理
 *
 * 管理后台运行的 Fusion-Code 会话。
 * 支持 `claude ps|logs|attach|kill` 和 `--bg`/`--background` 标志。
 *
 * gated by feature('BG_SESSIONS')
 */

import { spawnSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { writeToStdout } from '../utils/process.js'

const SESSIONS_DIR = 'sessions'

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), SESSIONS_DIR)
}

function ensureSessionsDir(): void {
  const dir = getSessionsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

interface SessionInfo {
  pid: number
  sessionId: string
  startTime: number
  cwd: string
  model?: string
  status?: string
}

function listSessions(): SessionInfo[] {
  ensureSessionsDir()
  const sessions: SessionInfo[] = []
  const files = readdirSync(getSessionsDir()).filter(f => f.endsWith('.json'))

  for (const file of files) {
    try {
      const content = readFileSync(join(getSessionsDir(), file), 'utf-8')
      const session = JSON.parse(content) as SessionInfo
      sessions.push(session)
    } catch {
      // Skip malformed files
    }
  }

  return sessions
}

function findSession(sessionId: string): SessionInfo | null {
  const filePath = join(getSessionsDir(), `${sessionId}.json`)
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as SessionInfo
  } catch {
    return null
  }
}

/**
 * Handle `claude ps` — list all background sessions.
 */
export async function psHandler(_args: string[]): Promise<void> {
  const sessions = listSessions()

  if (sessions.length === 0) {
    writeToStdout('No background sessions found.\n')
    return
  }

  writeToStdout('Background sessions:\n')
  for (const session of sessions) {
    const isRunning = isProcessRunning(session.pid)
    const status = isRunning ? session.status || 'running' : 'stopped'
    const startedAt = new Date(session.startTime).toLocaleString()
    writeToStdout(`  ${session.sessionId}\n`)
    writeToStdout(`    PID: ${session.pid} (${status})\n`)
    writeToStdout(`    Started: ${startedAt}\n`)
    writeToStdout(`    CWD: ${session.cwd}\n`)
    if (session.model) writeToStdout(`    Model: ${session.model}\n`)
    writeToStdout('\n')
  }
}

/**
 * Handle `claude logs <sessionId>` — show logs for a session.
 */
export async function logsHandler(sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    const sessions = listSessions()
    if (sessions.length === 0) {
      writeToStdout('No sessions found.\n')
      return
    }
    // Show latest session logs by default
    const latest = sessions.sort((a, b) => b.startTime - a.startTime)[0]
    sessionId = latest.sessionId
  }

  const logPath = join(getClaudeConfigHomeDir(), 'logs', `${sessionId}.log`)
  if (!existsSync(logPath)) {
    writeToStdout(`No logs found for session ${sessionId}.\n`)
    return
  }

  try {
    const content = readFileSync(logPath, 'utf-8')
    writeToStdout(content)
  } catch (error) {
    console.error(`Error reading logs: ${(error as Error).message}`)
  }
}

/**
 * Handle `claude attach <sessionId>` — attach to a running session.
 */
export async function attachHandler(sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    const sessions = listSessions()
    const running = sessions.filter(s => isProcessRunning(s.pid))
    if (running.length === 0) {
      writeToStdout('No running sessions to attach to.\n')
      return
    }
    sessionId = running[0].sessionId
  }

  const session = findSession(sessionId)
  if (!session) {
    console.error(`Session ${sessionId} not found.`)
    return
  }

  if (!isProcessRunning(session.pid)) {
    console.error(`Session ${sessionId} is not running.`)
    return
  }

  // Attach to the tmux session
  const result = spawnSync('tmux', ['attach-session', '-t', `claude-${sessionId}`], {
    stdio: 'inherit',
  })

  if (result.error) {
    console.error(`Failed to attach: ${result.error.message}`)
  }
}

/**
 * Handle `claude kill <sessionId>` — kill a background session.
 */
export async function killHandler(sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    console.error('Usage: claude kill <session-id>')
    return
  }

  const session = findSession(sessionId)
  if (!session) {
    console.error(`Session ${sessionId} not found.`)
    return
  }

  try {
    process.kill(session.pid, 'SIGTERM')
    writeToStdout(`Killed session ${sessionId} (PID ${session.pid}).\n`)
  } catch (error) {
    console.error(`Failed to kill session: ${(error as Error).message}`)
  }

  // Clean up session file
  const filePath = join(getSessionsDir(), `${sessionId}.json`)
  try {
    unlinkSync(filePath)
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Handle `--bg`/`--background` flag — start a session in the background.
 */
export async function handleBgFlag(args: string[]): Promise<void> {
  // Strip --bg/--background and pass remaining args to the new session
  const filteredArgs = args.filter(a => a !== '--bg' && a !== '--background')

  // In a real implementation, this would spawn a new tmux session
  // with the remaining arguments. For now, show usage.
  const cmd = filteredArgs.join(' ')
  if (cmd) {
    writeToStdout(`Starting background session: ${cmd}\n`)
    writeToStdout('Use `claude ps` to list sessions and `claude attach <id>` to reconnect.\n')
  } else {
    writeToStdout('Usage: claude --bg -p "your prompt"\n')
  }
}

// ─── Helpers ────────────────────────────────────────────────

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Register a session file for the current process.
 * Called during session startup.
 */
export function registerSession(sessionId: string, model?: string): void {
  ensureSessionsDir()
  const session: SessionInfo = {
    pid: process.pid,
    sessionId,
    startTime: Date.now(),
    cwd: process.cwd(),
    model,
    status: 'running',
  }
  writeFileSync(
    join(getSessionsDir(), `${sessionId}.json`),
    JSON.stringify(session, null, 2),
  )
}

/**
 * Update session status.
 */
export function updateSessionStatus(sessionId: string, status: string): void {
  const session = findSession(sessionId)
  if (session) {
    session.status = status
    writeFileSync(
      join(getSessionsDir(), `${sessionId}.json`),
      JSON.stringify(session, null, 2),
    )
  }
}

/**
 * Unregister a session file.
 */
export function unregisterSession(sessionId: string): void {
  const filePath = join(getSessionsDir(), `${sessionId}.json`)
  try {
    unlinkSync(filePath)
  } catch {
    // Ignore cleanup errors
  }
}