import type { Command } from '../../commands.js'

const subtask = {
    type: 'local-jsx',
    name: 'subtask',
    description: 'Spawn an inline sub-agent to handle a specific task',
    argumentHint: '<description>',
    load: () => import('./subtask.js'),
} satisfies Command

export default subtask
