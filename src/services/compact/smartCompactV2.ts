import { logForDebugging } from '../../utils/debug.js'

export interface SmartCompactConfig {
    toolResultMaxLines: number
    preserveCodeBlocks: boolean
    preserveToolNames: string[]
    aggressiveThreshold: number
}

const DEFAULT_CONFIG: SmartCompactConfig = {
    toolResultMaxLines: 50,
    preserveCodeBlocks: true,
    preserveToolNames: ['Read', 'Write', 'Edit', 'Bash'],
    aggressiveThreshold: 80000,
}

export function smartTruncateToolResult(
    content: string,
    toolName: string,
    config?: Partial<SmartCompactConfig>,
): string {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    const lines = content.split('\n')

    if (cfg.preserveToolNames.includes(toolName)) {
        return content
    }

    if (lines.length <= cfg.toolResultMaxLines) {
        return content
    }

    const head = lines.slice(0, Math.floor(cfg.toolResultMaxLines / 2))
    const tail = lines.slice(-Math.floor(cfg.toolResultMaxLines / 2))
    const omitted = lines.length - head.length - tail.length

    const result = [
        ...head,
        `  ... [smart-compact: ${omitted} lines omitted] ...`,
        ...tail,
    ].join('\n')

    logForDebugging(`[smart-compact-v2] truncated ${toolName}: ${lines.length} -> ${cfg.toolResultMaxLines} lines`)
    return result
}

export function smartCompactMessages(
    messages: Array<{ role: string; content: unknown }>,
    tokenEstimate: number,
    config?: Partial<SmartCompactConfig>,
): Array<{ role: string; content: unknown }> {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    const isAggressive = tokenEstimate > cfg.aggressiveThreshold

    logForDebugging(`[smart-compact-v2] ${messages.length} messages, aggressive=${isAggressive}, tokens~${tokenEstimate}`)

    return messages.map((msg, idx) => {
        if (idx === 0 || idx === messages.length - 1) return msg

        if (typeof msg.content === 'string') {
            if (isAggressive && msg.content.length > 500) {
                return { ...msg, content: msg.content.slice(0, 500) + '\n... [smart-compact truncated]' }
            }
        }

        if (Array.isArray(msg.content)) {
            const compacted = msg.content.map((block: any) => {
                if (block.type === 'tool_result' && typeof block.content === 'string') {
                    return {
                        ...block,
                        content: smartTruncateToolResult(block.content, block.tool_use_id || 'unknown', cfg),
                    }
                }
                return block
            })
            return { ...msg, content: compacted }
        }

        return msg
    })
}
