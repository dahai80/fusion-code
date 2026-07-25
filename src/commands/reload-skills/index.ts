import type { Command } from '../../commands.js'

const reloadSkills = {
    type: 'local',
    name: 'reload-skills',
    description: 'Reload skills without restarting the session',
    supportsNonInteractive: false,
    load: () => import('./reload-skills.js'),
} satisfies Command

export default reloadSkills
