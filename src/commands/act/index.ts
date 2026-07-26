import type { Command } from '../../commands.js'

const act = {
    type: 'local-jsx',
    name: 'act',
    description: 'Switch to act mode: enable all tools for implementation',
    argumentHint: '[description]',
    load: () => import('./act.js'),
} satisfies Command

export default act
