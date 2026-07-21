/**
 * MonitorTool — 监控工具
 *
 * 允许 AI 模型监控后台进程的输出流。
 * 与 BashTool 的 run_in_background 配合使用，
 * 实时获取进程输出，无需轮询。
 *
 * gated by feature('MONITOR_TOOL')
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const MONITOR_TOOL_NAME = 'Monitor'

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The command to monitor (must be a long-running process)'),
    description: z.string().optional().describe('Description of what is being monitored'),
    timeout: z.number().int().min(5000).max(600_000).optional().default(120_000)
      .describe('Maximum time to monitor in ms (default: 120s, max: 600s)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
  z.object({
    exit_code: z.number().describe('Exit code of the monitored process'),
    stdout: z.string().describe('Captured stdout from the process'),
    stderr: z.string().describe('Captured stderr from the process'),
    timed_out: z.boolean().describe('Whether the monitor timed out'),
    duration_ms: z.number().describe('How long the monitor ran'),
    lines_captured: z.number().describe('Number of output lines captured'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Tool Implementation ────────────────────────────────────

async function monitorToolCall(
  input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
  const startTime = Date.now()
  const { execa } = await import('execa')

  try {
    const subprocess = execa(input.command, {
      shell: true,
      timeout: input.timeout || 120_000,
      reject: false,
      all: false,
    })

    const result = await subprocess
    const lines = (result.stdout || '').split('\n').filter(Boolean)

    return {
      exit_code: result.exitCode ?? -1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      timed_out: result.timedOut || false,
      duration_ms: Date.now() - startTime,
      lines_captured: lines.length,
    }
  } catch (error) {
    return {
      exit_code: -1,
      stdout: '',
      stderr: `Monitor error: ${(error as Error).message}`,
      timed_out: false,
      duration_ms: Date.now() - startTime,
      lines_captured: 0,
    }
  }
}

// ─── Tool Definition ────────────────────────────────────────

const toolDef: ToolDef<InputSchema, OutputSchema> = {
  name: MONITOR_TOOL_NAME,
  description: `Monitor a long-running process and stream its output. Use this instead of polling with sleep loops. The process runs in the background and each line of stdout is returned as a notification. Supports timeout.`,
  inputSchema,
  outputSchema,
  call: monitorToolCall,
  userFacingName: () => 'Monitor',
  isEnabled: () => true,
}

export const MonitorTool = buildTool(toolDef, {
  monitorToolInputToPermissionRuleContent(input: {
    [k: string]: unknown
  }): string {
    const cmd = input.command as string | undefined
    return cmd ? `command:${cmd.slice(0, 100)}` : 'input:monitor'
  },
})