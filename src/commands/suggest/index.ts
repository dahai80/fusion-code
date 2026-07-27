import type { Command } from '../../commands.js'
const suggest = {
    type: 'local',
    name: 'suggest',
    description: 'Show suggested next actions based on current context',
    aliases: ['next'],
    argumentHint: '[context]',
    load: () => import('./suggest.js'),
} satisfies Command
export default suggest
