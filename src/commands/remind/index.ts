import type { Command } from '../../commands.js'

const remind = {
    type: 'local',
    name: 'remind',
    description: 'Toggle runtime reminders (git, scope, context, security, test)',
    argumentHint: '<list|enable|disable> [type]',
    supportsNonInteractive: true,
    load: () => import('./remind.js'),
} satisfies Command

export default remind
