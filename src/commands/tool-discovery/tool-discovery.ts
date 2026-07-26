import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { formatToolDiscoveryReport } from '../../services/tool-discovery/index.js'

export const call: LocalCommandCall = async (args, _context) => {
    const action = args.trim().toLowerCase()

    if (action === 'metrics') {
        const { getToolUsageMetrics } = await import('../../services/tool-discovery/toolDiscovery.js')
        const metrics = getToolUsageMetrics()
        if (metrics.size === 0) {
            return { type: 'text', value: 'No tool usage metrics recorded yet.' } satisfies LocalCommandResult
        }
        const lines = ['Tool Usage Metrics:', '']
        const sorted = [...metrics.entries()].sort((a, b) => b[1].count - a[1].count)
        for (const [name, { count, lastUsed }] of sorted) {
            const ago = Math.round((Date.now() - lastUsed) / 60000)
            lines.push(`  ${name}: ${count}x (last ${ago}m ago)`)
        }
        return { type: 'text', value: lines.join('\n') } satisfies LocalCommandResult
    }

    const report = formatToolDiscoveryReport()
    return { type: 'text', value: report } satisfies LocalCommandResult
}
