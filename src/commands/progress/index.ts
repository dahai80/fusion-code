import type { Command } from '../../commands.js'
const progress = {
    type: 'local',
    name: 'progress',
    description: 'Show current task progress and recent events',
    aliases: ['events'],
    load: () => import('./progress.js'),
} satisfies Command
export default progress
