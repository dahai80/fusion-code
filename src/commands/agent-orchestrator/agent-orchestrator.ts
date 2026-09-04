import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { formatAgentReport, spawnAgent, listAgents, mergeResults, removeAgent } from '../../services/agents/index.js'
import type { AgentRole } from '../../services/agents/agentOrchestrator.js'

const VALID_ROLES: AgentRole[] = ['researcher', 'coder', 'reviewer', 'tester', 'deployer']

export const call: LocalCommandCall = async (args, _context) => {
    const parts = args.trim().split(/\s+/)
    const action = parts[0]?.toLowerCase() ?? ''

    if (action === 'spawn') {
        const role = parts[1]?.toLowerCase() as AgentRole
        if (!role || !VALID_ROLES.includes(role)) {
            return {
                type: 'text',
                value: `Invalid role. Available: ${VALID_ROLES.join(', ')}\nUsage: /agent-orchestrator spawn <role> [task]`,
            } satisfies LocalCommandResult
        }
        const task = parts.slice(2).join(' ') || `General ${role} task`
        const agent = spawnAgent(role, task)
        if (!agent) {
            return {
                type: 'text',
                value: `Spawn denied: orchestrator agent cap reached. Remove completed agents or raise FUSION_MAX_ORCHESTRATOR_AGENTS.`,
            } satisfies LocalCommandResult
        }
        return {
            type: 'text',
            value: `Spawned agent: ${agent.id} (${role})\nTask: ${task}\nTools: ${agent.config.allowedTools.join(', ')}`,
        } satisfies LocalCommandResult
    }

    if (action === 'list') {
        const agents = listAgents()
        if (agents.length === 0) {
            return { type: 'text', value: 'No active agents.' } satisfies LocalCommandResult
        }
        const lines = agents.map(a => {
            const elapsed = a.completedAt
                ? Math.round((a.completedAt - a.createdAt) / 1000)
                : Math.round((Date.now() - a.createdAt) / 1000)
            return `  ${a.id} [${a.status}] (${elapsed}s) — ${a.task.slice(0, 60)}`
        })
        return { type: 'text', value: `Agents (${agents.length}):\n${lines.join('\n')}` } satisfies LocalCommandResult
    }

    if (action === 'merge') {
        const ids = parts.slice(1).length > 0 ? parts.slice(1) : undefined
        const result = mergeResults(ids)
        if (result.agentCount === 0) {
            return { type: 'text', value: 'No completed agents to merge.' } satisfies LocalCommandResult
        }
        return {
            type: 'text',
            value: `Merged ${result.agentCount} agent(s):\n\n${result.merged}`,
        } satisfies LocalCommandResult
    }

    if (action === 'remove') {
        const id = parts[1]
        if (!id) {
            return { type: 'text', value: 'Usage: /agent-orchestrator remove <id>' } satisfies LocalCommandResult
        }
        const removed = removeAgent(id)
        return {
            type: 'text',
            value: removed ? `Agent ${id} removed.` : `Agent ${id} not found.`,
        } satisfies LocalCommandResult
    }

    const report = formatAgentReport()
    return { type: 'text', value: report } satisfies LocalCommandResult
}
