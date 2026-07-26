import type { Command } from '../../commands.js'

const projectInit = {
    type: 'local',
    name: 'project-init',
    description: 'Detect project stack and generate onboarding configuration plan',
    supportsNonInteractive: true,
    argumentHint: '[--target claude|cursor] [--dry-run]',
    load: () => import('./projectInit.js'),
} satisfies Command

export default projectInit
