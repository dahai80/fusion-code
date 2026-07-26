import type { Command } from '../../commands.js'
const integrations = {
    type: 'local',
    name: 'integrations',
    description: 'Browse and manage MCP integrations and plugins',
    argumentHint: '[search|add|list]',
    load: () => import('./integrations.js'),
} satisfies Command
export default integrations
