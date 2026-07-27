import type { Command } from '../../commands.js'

const checkpoint = {
    type: 'local',
    name: 'checkpoint',
    description: 'Create, verify, or list workflow checkpoints',
    aliases: ['cp'],
    supportsNonInteractive: true,
    argumentHint: '[create|verify|list] [name]',
    load: () => import('./checkpoint.js'),
} satisfies Command

export default checkpoint
