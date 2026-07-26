import type { Command } from '../../commands.js'

const loopStatus = {
    type: 'local',
    name: 'loop-status',
    description: 'Show active loop/cron jobs, detect stale wakeups, report loop state',
    aliases: ['ls-loop'],
    supportsNonInteractive: true,
    load: () => import('./loopStatus.js'),
} satisfies Command

export default loopStatus
