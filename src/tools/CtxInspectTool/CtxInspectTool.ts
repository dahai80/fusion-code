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

// ─── Tool Definition ────────────────────────────────────────

const DESCRIPTION = `Inspect the current conversation context: view token usage, context window utilization, and message statistics. Useful for monitoring context limits and deciding when to compact or summarize.`

export type Output = z.infer<OutputSchema>

// log: restructured to match ToolDef pattern (buildTool single-arg, proper schemas)
export const CtxInspectTool = buildTool({
    name: CTX_INSPECT_TOOL_NAME,
    searchHint: 'inspect context window and token usage',
    maxResultSizeChars: 10_000,
    async description() {
        return DESCRIPTION
    },
    async prompt() {
        return DESCRIPTION
    },
    get inputSchema(): InputSchema {
        return inputSchema()
    },
    get outputSchema(): OutputSchema {
        return outputSchema()
    },
    // log: execute signature expanded to match Tool type (5 params)
    async execute(input, _context, _canUseTool?, _parentMessage?, _onProgress?) {
        const contextWindow = getContextWindowForModel('default')
        const totalInput = getTotalInputTokens()
        const totalOutput = getTotalOutputTokens()

        // Estimate used tokens (simplified: input + output tokens)
        const usedTokens = totalInput + totalOutput
        const availableTokens = Math.max(0, contextWindow - usedTokens)
        const utilizationPct = Math.min(100, Math.round((usedTokens / contextWindow) * 100))

        return {
            data: {
                context_window: contextWindow,
                used_tokens: usedTokens,
                available_tokens: availableTokens,
                utilization_pct: utilizationPct,
                total_input_tokens: totalInput,
                total_output_tokens: totalOutput,
                message_count: 0,
                scope: input.scope || 'current',
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const data = content as Output
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: `Context: ${data.utilization_pct}% used (${data.used_tokens}/${data.context_window} tokens, ${data.available_tokens} available). Scope: ${data.scope}`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)