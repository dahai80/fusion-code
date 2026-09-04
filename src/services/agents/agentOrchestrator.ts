import { EventEmitter } from 'events'
import { logForDebugging } from '../../utils/debug.js'

export type AgentRole = 'researcher' | 'coder' | 'reviewer' | 'tester' | 'deployer'

export interface AgentConfig {
    role: AgentRole
    name: string
    description: string
    allowedTools: string[]
    systemPromptSuffix: string
}

const ROLE_CONFIGS: Record<AgentRole, Omit<AgentConfig, 'name'>> = {
    researcher: {
        role: 'researcher',
        description: 'Search and gather information from web, docs, and codebase',
        allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash', 'LSP'],
        systemPromptSuffix: 'You are a research agent. Focus on gathering information. Do not edit files.',
    },
    coder: {
        role: 'coder',
        description: 'Implement code changes and write new features',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'LSP'],
        systemPromptSuffix: 'You are a coding agent. Focus on implementing changes. Follow project conventions.',
    },
    reviewer: {
        role: 'reviewer',
        description: 'Review code for bugs, security issues, and best practices',
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'LSP'],
        systemPromptSuffix: 'You are a review agent. Focus on finding issues. Do not edit files — report findings only.',
    },
    tester: {
        role: 'tester',
        description: 'Write and run tests, verify correctness',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        systemPromptSuffix: 'You are a testing agent. Focus on writing and running tests. Verify correctness.',
    },
    deployer: {
        role: 'deployer',
        description: 'Handle deployment, CI/CD, and infrastructure',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        systemPromptSuffix: 'You are a deployment agent. Focus on deploy, CI/CD, and infrastructure tasks.',
    },
}

export interface AgentInstance {
    id: string
    config: AgentConfig
    status: 'idle' | 'running' | 'completed' | 'failed'
    task: string
    result?: string
    createdAt: number
    completedAt?: number
}

// audit 0905 P1-R5: 无并发 cap, activeAgents Map 无界增长 (N 个 spawn 累积, 即
// 使完成也不清), 间接放大下游负载。有限 cap (默认 16), env 覆盖, 0=无界 (兼容)。
// 与 subagentGuardrails 的 FUSION_MAX_CONCURRENT_SUBAGENTS 区分: 此 cap 限本
// orchestrator 注册表内 (含 idle/completed 残留), subagentGuardrails 限真实子进程。
const DEFAULT_MAX_ORCHESTRATOR_AGENTS = 16
function maxOrchestratorAgents(): number {
    const raw = process.env.FUSION_MAX_ORCHESTRATOR_AGENTS
    if (raw === undefined || raw === '') return DEFAULT_MAX_ORCHESTRATOR_AGENTS
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
        logForDebugging(
            `[agentOrchestrator] invalid FUSION_MAX_ORCHESTRATOR_AGENTS "${raw}", defaulting to ${DEFAULT_MAX_ORCHESTRATOR_AGENTS}`,
        )
        return DEFAULT_MAX_ORCHESTRATOR_AGENTS
    }
    if (n === 0) return Infinity
    return Math.floor(n)
}

const agentBus = new EventEmitter()
agentBus.setMaxListeners(50)

const activeAgents: Map<string, AgentInstance> = new Map()
let agentCounter = 0

export function createAgentConfig(role: AgentRole, customName?: string): AgentConfig {
    const base = ROLE_CONFIGS[role]
    return {
        ...base,
        name: customName ?? `${role}-${++agentCounter}`,
    }
}

export function spawnAgent(
    role: AgentRole,
    task: string,
    customName?: string,
): AgentInstance | null {
    const cap = maxOrchestratorAgents()
    if (activeAgents.size >= cap) {
        logForDebugging(
            `[agentOrchestrator] spawn denied: ${activeAgents.size} registered >= cap ${cap} (FUSION_MAX_ORCHESTRATOR_AGENTS)`,
            { level: 'warn' },
        )
        return null
    }
    const config = createAgentConfig(role, customName)
    const instance: AgentInstance = {
        id: config.name,
        config,
        status: 'idle',
        task,
        createdAt: Date.now(),
    }
    activeAgents.set(instance.id, instance)
    agentBus.emit('agent:spawned', instance)
    return instance
}

export function assignTask(agentId: string, task: string): AgentInstance | null {
    const agent = activeAgents.get(agentId)
    if (!agent) return null
    agent.task = task
    agent.status = 'idle'
    agent.result = undefined
    agent.completedAt = undefined
    agentBus.emit('agent:assigned', { agentId, task })
    return agent
}

export function updateAgentStatus(agentId: string, status: AgentInstance['status'], result?: string): AgentInstance | null {
    const agent = activeAgents.get(agentId)
    if (!agent) return null
    agent.status = status
    if (result !== undefined) agent.result = result
    if (status === 'completed' || status === 'failed') agent.completedAt = Date.now()
    agentBus.emit('agent:status', { agentId, status, result })
    return agent
}

export function getAgent(agentId: string): AgentInstance | null {
    return activeAgents.get(agentId) ?? null
}

export function listAgents(): AgentInstance[] {
    return [...activeAgents.values()]
}

export function removeAgent(agentId: string): boolean {
    const removed = activeAgents.delete(agentId)
    if (removed) agentBus.emit('agent:removed', { agentId })
    return removed
}

export function mergeResults(agentIds?: string[]): { merged: string; agentCount: number } {
    const agents = agentIds
        ? agentIds.map(id => activeAgents.get(id)).filter((a): a is AgentInstance => !!a)
        : [...activeAgents.values()].filter(a => a.status === 'completed')

    const parts = agents
        .filter(a => a.result)
        .map(a => `## ${a.config.name} (${a.config.role})\n${a.result}`)

    return {
        merged: parts.join('\n\n---\n\n'),
        agentCount: agents.length,
    }
}

export function getAgentBus(): EventEmitter {
    return agentBus
}

export function formatAgentReport(): string {
    const agents = listAgents()
    const lines = [
        `Multi-Agent Orchestrator`,
        ``,
        `Active Agents: ${agents.length}`,
        '',
    ]
    if (agents.length === 0) {
        lines.push('No agents spawned. Use /agent spawn <role> to create one.')
        lines.push('')
        lines.push('Available roles:')
        for (const [role, cfg] of Object.entries(ROLE_CONFIGS)) {
            lines.push(`  ${role} — ${cfg.description}`)
        }
        return lines.join('\n')
    }
    for (const agent of agents) {
        const status = agent.status.toUpperCase()
        const elapsed = agent.completedAt
            ? Math.round((agent.completedAt - agent.createdAt) / 1000)
            : Math.round((Date.now() - agent.createdAt) / 1000)
        lines.push(`  ${agent.id} [${status}] (${elapsed}s) — ${agent.task.slice(0, 60)}`)
        if (agent.result) {
            const preview = agent.result.slice(0, 120).replace(/\n/g, ' ')
            lines.push(`    result: ${preview}${agent.result.length > 120 ? '...' : ''}`)
        }
    }
    lines.push('')
    lines.push('Commands:')
    lines.push('  /agent spawn <role> [task]  — Spawn a new agent')
    lines.push('  /agent list                 — List all agents')
    lines.push('  /agent assign <id> <task>   — Reassign a task')
    lines.push('  /agent merge [ids]          — Merge completed results')
    lines.push('  /agent remove <id>          — Remove an agent')
    return lines.join('\n')
}
