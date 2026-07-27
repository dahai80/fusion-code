import type { Command } from '../../commands.js'

const goal = {
    type: 'local-jsx',
    name: 'goal',
    description: 'Set or view the session goal. Use /goal <text> to set, /goal to view, /goal clear to remove.',
    argumentHint: '<goal text | clear>',
    load: () => import('./goal.js'),
} satisfies Command

export default goal
