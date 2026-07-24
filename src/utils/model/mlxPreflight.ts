import { logForDebugging } from '../debug.js'
import {
    COMPACT_MAX_OUTPUT_TOKENS,
    getContextWindowForModel,
} from '../context.js'
import { isFusionMlxProvider } from './providers.js'
import { getMainLoopModel } from './model.js'
import { roughTokenCountEstimation } from '../../services/tokenEstimation.js'
import { tokenCountWithEstimation } from '../tokens.js'
import { isMcpTool } from '../../services/mcp/utils.js'
import type { Message } from '../../types/message.js'
import type { Tool } from '../../Tool.js'

const MLX_QUERY_TOKEN_SAFETY_FACTOR = 0.7

const MLX_ESSENTIAL_TOOL_NAMES = new Set([
    'Read', 'Write', 'Edit', 'Bash',
    'Grep', 'Glob', 'LS',
    'TodoRead', 'TodoWrite',
    'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList',
    'WebSearch', 'WebFetch',
])

export interface MlxPreflightResult {
    fits: boolean
    estimatedTokens: number
    safeBudget: number
    reducedTools?: Tool[]
}

export function estimateSystemPromptTokens(systemPrompt: readonly string[]): number {
    let total = 0
    for (const part of systemPrompt) {
        total += roughTokenCountEstimation(part)
    }
    return total
}

export function estimateToolsTokens(tools: Tool[]): number {
    let total = 0
    for (const tool of tools) {
        total += roughTokenCountEstimation(tool.name)
        try {
            const schema = JSON.stringify(tool.inputSchema)
            total += roughTokenCountEstimation(schema)
        } catch {
            // estimate ~200 tokens per tool schema if serialization fails
            total += 200
        }
    }
    return total
}

export function getMlxReducedTools(tools: Tool[]): Tool[] {
    return tools.filter(t => {
        if (MLX_ESSENTIAL_TOOL_NAMES.has(t.name)) return true
        if (isMcpTool(t)) return true
        return false
    })
}

export function preflightMlxQueryCheck(
    systemPrompt: string,
    tools: Tool[],
    messages: Message[],
): MlxPreflightResult {
    if (!isFusionMlxProvider()) {
        return { fits: true, estimatedTokens: 0, safeBudget: Infinity }
    }

    const model = getMainLoopModel()
    if (!model) {
        logForDebugging(`[MLX-Preflight] no model, skipping`, { level: 'warn' })
        return { fits: true, estimatedTokens: 0, safeBudget: Infinity }
    }

    const contextWindow = getContextWindowForModel(model)
    if (!contextWindow || contextWindow <= 0) {
        logForDebugging(`[MLX-Preflight] no context window for ${model}`, { level: 'warn' })
        return { fits: true, estimatedTokens: 0, safeBudget: Infinity }
    }

    const safeBudget = Math.floor(
        (contextWindow - COMPACT_MAX_OUTPUT_TOKENS) * MLX_QUERY_TOKEN_SAFETY_FACTOR,
    )

    const systemTokens = estimateSystemPromptTokens(systemPrompt)
    const toolsTokens = estimateToolsTokens(tools)
    const messagesTokens = tokenCountWithEstimation(messages)
    const total = systemTokens + toolsTokens + messagesTokens

    logForDebugging(
        `[MLX-Preflight] estimate: system=${systemTokens} tools=${toolsTokens} messages=${messagesTokens} total=${total} budget=${safeBudget} (window=${contextWindow})`,
    )

    if (total <= safeBudget) {
        return { fits: true, estimatedTokens: total, safeBudget }
    }

    logForDebugging(
        `[MLX-Preflight] OVER BUDGET: ${total} > ${safeBudget}, trying tool reduction`,
        { level: 'warn' },
    )

    const reducedTools = getMlxReducedTools(tools)
    const reducedToolsTokens = estimateToolsTokens(reducedTools)
    const reducedTotal = systemTokens + reducedToolsTokens + messagesTokens

    if (reducedTotal <= safeBudget) {
        logForDebugging(
            `[MLX-Preflight] tool reduction OK: ${tools.length}->${reducedTools.length} tools, ${reducedTotal} <= ${safeBudget}`,
        )
        return {
            fits: true,
            estimatedTokens: reducedTotal,
            safeBudget,
            reducedTools,
        }
    }

    logForDebugging(
        `[MLX-Preflight] still over after tool reduction: ${reducedTotal} > ${safeBudget}`,
        { level: 'warn' },
    )

    return {
        fits: false,
        estimatedTokens: reducedTotal,
        safeBudget,
        reducedTools,
    }
}
