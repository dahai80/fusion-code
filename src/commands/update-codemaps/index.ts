import type { Command } from '../../commands.js'

const updateCodemaps = {
    type: 'local',
    name: 'update-codemaps',
    description: 'Scan project structure and generate token-lean architecture codemaps',
    aliases: ['codemaps'],
    supportsNonInteractive: true,
    argumentHint: '[architecture|backend|frontend|data|dependencies]',
    load: () => import('./updateCodemaps.js'),
} satisfies Command

export default updateCodemaps
