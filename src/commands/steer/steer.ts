import type { CommandContext, LocalCommandResult } from '../../types/command.js'
import { getSteerQueue } from '../../services/steer/index.js'

export async function execute(
    _context: CommandContext,
    args?: string,
): Promise<LocalCommandResult> {
    const content = args?.trim()

    if (content === 'clear') {
        const sq = getSteerQueue()
        const count = sq.size()
        sq.clear()
        return { type: 'text', value: `Cleared ${count} pending steer(s).` }
    }

    if (!content) {
        const sq = getSteerQueue()
        if (!sq.hasPending()) {
            return { type: 'text', value: 'No pending steers. Use /steer <text> to inject follow-up input.\nCommands: /steer <text> | /steer clear' }
        }
        const items = sq.drain()
        const combined = items.join('\n\n---\n\n')
        return { type: 'text', value: `Submitting ${items.length} steer(s) as next input:\n${combined}` }
    }

    const sq = getSteerQueue()
    sq.enqueue(content)

    return {
        type: 'text',
        value: `Steer queued: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" (${sq.size()} pending)\nUse /steer (no args) to submit all, /steer clear to discard.`,
    }
}
