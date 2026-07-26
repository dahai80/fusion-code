import type { Command } from '../../commands.js'

const skillCreate = {
    type: 'local',
    name: 'skill-create',
    description: 'Analyze git history to extract coding patterns and generate SKILL.md files',
    supportsNonInteractive: true,
    argumentHint: '[--commits N] [--output dir]',
    load: () => import('./skillCreate.js'),
} satisfies Command

export default skillCreate
