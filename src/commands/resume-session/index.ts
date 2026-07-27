import type { Command } from '../../commands.js'

const resumeSession = {
    type: 'local',
    name: 'resume-session',
    description: 'Resume a previously saved session by name, or list saved sessions',
    aliases: ['rs'],
    supportsNonInteractive: true,
    argumentHint: '[name]',
    load: () => import('./resumeSession.js'),
} satisfies Command

export default resumeSession
