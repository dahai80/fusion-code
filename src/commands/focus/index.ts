import type { Command } from '../../commands.js'

const focus = {
    type: 'local-jsx',
    name: 'focus',
    description: 'Toggle focus view: show only key output, hide verbose tool results. Use /focus on|off|status.',
    argumentHint: 'on|off|status',
    load: () => import('./focus.js'),
} satisfies Command

export default focus
