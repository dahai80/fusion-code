import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { eventStream } from '../../services/events/index.js'

export const call: LocalCommandCall = async (args, _context) => {
    const arg = args.trim().toLowerCase()
    const typeFilter = arg || undefined
    const events = eventStream.getHistory(typeFilter as any)
    const recent = events.slice(-20)

    if (recent.length === 0) {
        return {
            type: 'text',
            value: 'No events recorded in this session.',
        } satisfies LocalCommandResult
    }

    const output = recent.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString()
        const dataStr = Object.entries(e.data)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        return `[${time}] ${e.type}/${e.severity} ${e.source}: ${dataStr}`
    }).join('\n')

    return {
        type: 'text',
        value: `Recent events (${recent.length}/${events.length}):\n${output}`,
    } satisfies LocalCommandResult
}
