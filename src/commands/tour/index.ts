import type { Command } from '../../commands.js'
const tour = {
    type: 'local',
    name: 'tour',
    description: 'Interactive feature walkthrough and project onboarding',
    load: () => import('./tour.js'),
} satisfies Command
export default tour
