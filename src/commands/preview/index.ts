import type { Command } from '../../commands.js'
const preview = {
    type: 'local',
    name: 'preview',
    description: 'Detect dev server and show preview info',
    load: () => import('./preview.js'),
} satisfies Command
export default preview
