import type { Command } from '../../commands.js'
const agentOrchestrator = {
    type: 'local',
    name: 'agent-orchestrator',
    description: 'Multi-agent orchestrator: spawn, list, merge, and manage agents',
    load: () => import('./agent-orchestrator.js'),
} satisfies Command
export default agentOrchestrator
