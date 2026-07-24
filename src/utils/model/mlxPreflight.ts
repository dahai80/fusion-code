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

const MLX_CORE_TOOL_NAMES = new Set([
    'Read', 'Edit', 'Bash', 'Glob', 'Grep',
])

const MLX_STANDARD_TOOL_NAMES = new Set([
    ...MLX_CORE_TOOL_NAMES,
    'Write', 'LS',
])

const MLX_EXTENDED_TOOL_NAMES = new Set([
    ...MLX_STANDARD_TOOL_NAMES,
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
            total += 200
        }
    }
    return total
}

export type MlxToolTier = 'core' | 'standard' | 'extended'

export function getMlxToolTier(contextWindow: number): MlxToolTier {
    if (contextWindow <= 32768) return 'core'
    if (contextWindow <= 65536) return 'standard'
    return 'extended'
}

export function getMlxReducedTools(tools: Tool[], contextWindow?: number): Tool[] {
    const model = getMainLoopModel()
    const cw = contextWindow || (model ? getContextWindowForModel(model) : 32768)
    const tier = getMlxToolTier(cw)
    const toolSet = tier === 'core' ? MLX_CORE_TOOL_NAMES
        : tier === 'standard' ? MLX_STANDARD_TOOL_NAMES
        : MLX_EXTENDED_TOOL_NAMES

    logForDebugging(
        `[MLX-Preflight] tool tier=${tier} (contextWindow=${cw}), toolSet size=${toolSet.size}`,
    )

    return tools.filter(t => {
        if (toolSet.has(t.name)) return true
        if (isMcpTool(t)) return true
        return false
    })
}

export function getMlxToolTokenBudget(contextWindow: number): number {
    const outputReserve = Math.min(COMPACT_MAX_OUTPUT_TOKENS, contextWindow * 0.25)
    const effectiveWindow = contextWindow - outputReserve
    const safeTotal = Math.floor(effectiveWindow * MLX_QUERY_TOKEN_SAFETY_FACTOR)
    const systemReserve = Math.floor(safeTotal * 0.55)
    const toolBudget = safeTotal - systemReserve
    logForDebugging(
        `[MLX-Preflight] tool budget: window=${contextWindow} outputReserve=${outputReserve} safeTotal=${safeTotal} systemReserve=${systemReserve} toolBudget=${toolBudget}`,
    )
    return toolBudget
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

    const reducedTools = getMlxReducedTools(tools, contextWindow)
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

    const toolBudget = getMlxToolTokenBudget(contextWindow)
    if (reducedToolsTokens > toolBudget) {
        const coreOnly = tools.filter(t => MLX_CORE_TOOL_NAMES.has(t.name) || isMcpTool(t))
        const coreTokens = estimateToolsTokens(coreOnly)
        const coreTotal = systemTokens + coreTokens + messagesTokens
        logForDebugging(
            `[MLX-Preflight] reduced tools still over budget (${reducedToolsTokens} > ${toolBudget}), falling back to core=${coreOnly.length} tools (${coreTokens} tokens)`,
            { level: 'warn' },
        )
        if (coreTotal <= safeBudget) {
            return {
                fits: true,
                estimatedTokens: coreTotal,
                safeBudget,
                reducedTools: coreOnly,
            }
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
