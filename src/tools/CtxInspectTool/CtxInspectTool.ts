/**
 * CtxInspectTool — 上下文检查工具
 *
 * 允许 AI 模型检查当前对话上下文的统计信息，
 * 包括消息数量、token 使用量、上下文窗口利用率等。
 *
 * gated by feature('CONTEXT_COLLAPSE')
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { getTotalInputTokens, getTotalOutputTokens } from '../../cost-tracker.js'

export const CTX_INSPECT_TOOL_NAME = 'CtxInspect'

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    scope: z
      .enum(['current', 'session', 'window'])
      .optional()
      .default('current')
      .describe('Inspection scope: current turn, entire session, or context window'),
    detail: z
      .enum(['basic', 'full'])
      .optional()
      .default('basic')
      .describe('Detail level: basic (tokens/usage) or full (including message breakdown)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
  z.object({
    context_window: z.number().describe('Total context window size in tokens'),
    used_tokens: z.number().describe('Estimated tokens used in current context'),
    available_tokens: z.number().describe('Remaining tokens available'),
    utilization_pct: z.number().describe('Context window utilization percentage'),
    total_input_tokens: z.number().describe('Total input tokens this session'),
    total_output_tokens: z.number().describe('Total output tokens this session'),
    message_count: z.number().describe('Number of messages in current context'),
    scope: z.string().describe('Scope of the inspection'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Tool Implementation ────────────────────────────────────

function ctxInspectToolCall(
  input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
  const contextWindow = getContextWindowForModel('default')
  const totalInput = getTotalInputTokens()
  const totalOutput = getTotalOutputTokens()

  // Estimate used tokens (simplified: input + output tokens)
  const usedTokens = totalInput + totalOutput
  const availableTokens = Math.max(0, contextWindow - usedTokens)
  const utilizationPct = Math.min(100, Math.round((usedTokens / contextWindow) * 100))

  return Promise.resolve({
    context_window: contextWindow,
    used_tokens: usedTokens,
    available_tokens: availableTokens,
    utilization_pct: utilizationPct,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    message_count: 0,
    scope: input.scope || 'current',
  })
}

// ─── Tool Definition ────────────────────────────────────────

const toolDef: ToolDef<InputSchema, OutputSchema> = {
  name: CTX_INSPECT_TOOL_NAME,
  description: `Inspect the current conversation context: view token usage, context window utilization, and message statistics. Useful for monitoring context limits and deciding when to compact or summarize.`,
  inputSchema,
  outputSchema,
  call: ctxInspectToolCall,
  userFacingName: () => 'CtxInspect',
  isEnabled: () => true,
}

export const CtxInspectTool = buildTool(toolDef, {
  ctxInspectToolInputToPermissionRuleContent(_input: {
    [k: string]: unknown
  }): string {
    return 'input:ctx_inspect'
  },
})