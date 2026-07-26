import type { Command } from '../../commands.js'

const saveSession = {
    type: 'local',
    name: 'save-session',
    description: 'Save current session with a name for later resumption',
    aliases: ['ss'],
    supportsNonInteractive: true,
    argumentHint: '<name>',
    load: () => import('./saveSession.js'),
} satisfies Command

export default saveSession
