import { listAllCronTasks, type CronTask } from '../../utils/cronTasks.js'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const STALE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

function isStale(task: CronTask): boolean {
    if (!task.lastFiredAt) return false
    const elapsed = Date.now() - new Date(task.lastFiredAt).getTime()
    return elapsed > STALE_THRESHOLD_MS
}

function formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
    return `${(ms / 3_600_000).toFixed(1)}h`
}

export const call: LocalCommandCall = async (_args, _context) => {
    const tasks = await listAllCronTasks()

    if (tasks.length === 0) {
        return {
            display: 'No active loops or scheduled jobs.',
        } satisfies LocalCommandResult
    }

    const lines: string[] = ['Active loops & scheduled jobs:', '']

    const recurring = tasks.filter((t: CronTask) => t.recurring !== false)
    const oneShot = tasks.filter((t: CronTask) => t.recurring === false)

    if (recurring.length > 0) {
        lines.push('  Recurring loops:')
        for (const t of recurring) {
            const stale = isStale(t) ? ' ⚠️ STALE' : ''
            const lastFired = t.lastFiredAt
                ? `last: ${formatDuration(Date.now() - new Date(t.lastFiredAt).getTime())} ago`
                : 'not yet fired'
            lines.push(`    ${t.id} | ${t.cron} | ${lastFired}${stale}`)
            lines.push(`      prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '...' : ''}`)
        }
    }

    if (oneShot.length > 0) {
        lines.push('')
        lines.push('  One-shot wakeups:')
        for (const t of oneShot) {
            const created = formatDuration(Date.now() - new Date(t.createdAt).getTime())
            lines.push(`    ${t.id} | created ${created} ago | ${t.cron}`)
            lines.push(`      prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '...' : ''}`)
        }
    }

    const staleCount = tasks.filter(isStale).length
    if (staleCount > 0) {
        lines.push('')
        lines.push(`⚠️  ${staleCount} stale job(s) detected (not fired in >30min). Consider deleting with /cron-delete.`)
    }

    lines.push('')
    lines.push(`Total: ${tasks.length} job(s) (${recurring.length} recurring, ${oneShot.length} one-shot)`)

    return {
        display: lines.join('\n'),
    } satisfies LocalCommandResult
}
