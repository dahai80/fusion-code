import type { Command } from '../../commands.js'

const cd = {
    type: 'local',
    name: 'cd',
    description: 'Change working directory',
    argumentHint: '<path>',
    supportsNonInteractive: true,
    load: () => import('./cd.js'),
} satisfies Command

export default cd
