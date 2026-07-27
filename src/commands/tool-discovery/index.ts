import type { Command } from '../../commands.js'
const toolDiscovery = {
    type: 'local',
    name: 'tool-discovery',
    description: 'Show tool tier classification, deferred tools, and usage metrics',
    load: () => import('./tool-discovery.js'),
} satisfies Command
export default toolDiscovery
