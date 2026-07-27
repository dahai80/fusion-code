import type { Command } from '../../commands.js'
const deploy = {
    type: 'local',
    name: 'deploy',
    description: 'Auto-detect platform and deploy current project',
    argumentHint: '[staging|production]',
    load: () => import('./deploy.js'),
} satisfies Command
export default deploy
