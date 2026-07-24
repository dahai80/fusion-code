import type { Command, LocalCommandCall } from '../../types/command.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { getTotalInputTokens, getTotalOutputTokens } from '../../cost-tracker.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { isFusionMlxProvider } from '../../utils/model/providers.js'

const BAR_WIDTH = 30

function bar(pct: number): string {
    const filled = Math.round((pct / 100) * BAR_WIDTH)
    const empty = BAR_WIDTH - filled
    const color = pct > 90 ? '█' : pct > 70 ? '▓' : pct > 40 ? '▒' : '░'
    return color.repeat(filled) + '─'.repeat(empty)
}

const call: LocalCommandCall = async () => {
    const model = getMainLoopModel() ?? 'unknown'
    const ctxWindow = getContextWindowForModel(model)
    const inputTokens = getTotalInputTokens()
    const outputTokens = getTotalOutputTokens()
    const usedTokens = inputTokens + outputTokens
    const availableTokens = Math.max(0, ctxWindow - usedTokens)
    const pct = Math.min(100, Math.round((usedTokens / ctxWindow) * 100))

    const lines: string[] = [
        '=== Context Window Visualization ===',
        '',
        `Model:     ${model}`,
        `Provider:  ${isFusionMlxProvider() ? 'fusion-mlx (local)' : 'cloud'}`,
        `Window:    ${ctxWindow.toLocaleString()} tokens`,
        '',
        `Input:     ${inputTokens.toLocaleString()} tokens`,
        `Output:    ${outputTokens.toLocaleString()} tokens`,
        `Used:      ${usedTokens.toLocaleString()} tokens (${pct}%)`,
        `Available: ${availableTokens.toLocaleString()} tokens`,
        '',
        `[${bar(pct)}] ${pct}%`,
        '',
    ]

    if (pct > 80) {
        lines.push('⚠  Context is getting full. Consider /compact to free up space.')
    } else if (pct > 60) {
        lines.push('ℹ  Context usage is moderate.')
    } else {
        lines.push('✓  Context has plenty of room.')
    }

    return { type: 'text', value: lines.join('\n') }
}

const ctx_viz = {
    type: 'local',
    name: 'ctx_viz',
    description: 'Visualize context window usage with a progress bar and token statistics',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default ctx_viz
