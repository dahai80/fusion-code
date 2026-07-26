import type { Command } from '../../commands.js'

const agentsMd = {
    type: 'local',
    name: 'agents-md',
    description: 'View effective AGENTS.md rules cascaded from current directory',
    aliases: ['agents'],
    argumentHint: '[path]',
    supportsNonInteractive: true,
    load: () => import('./agents-md.js'),
} satisfies Command

export default agentsMd
