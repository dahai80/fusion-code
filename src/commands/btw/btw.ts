import type { CommandContext, LocalCommandResult } from '../../types/command.js'
import { getSteerQueue } from '../../services/steer/steerQueue.js'

export async function execute(
    _context: CommandContext,
    args?: string,
): Promise<LocalCommandResult> {
    const question = args?.trim()
    if (!question) {
        return { type: 'text', value: 'Usage: /btw <question>\n\nAsk a side question without interrupting the main workflow.' }
    }

    const sq = getSteerQueue()
    const steerText = `[BTW - side question, answer in text only, no tool calls] ${question}`
    sq.enqueue(steerText)

    return {
        type: 'text',
        value: `Side question queued: "${question.slice(0, 80)}${question.length > 80 ? '...' : ''}"\nUse /steer to submit queued items.`,
    }
}
