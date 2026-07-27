import { isFusionMlxProvider } from '../../utils/model/providers.js'
import { getMainLoopModel } from '../../utils/model/model.js'

type ToolTier = 'core' | 'standard' | 'extended' | 'deferred'

const TIER_DEFINITIONS: Record<ToolTier, { description: string; loadStrategy: 'always' | 'on-demand' | 'deferred' }> = {
    core: { description: 'Essential tools always loaded', loadStrategy: 'always' },
    standard: { description: 'Common tools for daily coding', loadStrategy: 'always' },
    extended: { description: 'Specialized tools loaded when context allows', loadStrategy: 'on-demand' },
    deferred: { description: 'MCP/plugin tools loaded on first reference', loadStrategy: 'deferred' },
}

const TOOL_TIER_MAP: Record<string, ToolTier> = {
    Bash: 'core',
    Read: 'core',
    Write: 'core',
    Edit: 'core',
    Glob: 'core',
    Grep: 'core',
    AskUserQuestion: 'standard',
    TodoWrite: 'standard',
    WebFetch: 'standard',
    WebSearch: 'standard',
    LSP: 'standard',
    Agent: 'extended',
    TaskCreate: 'extended',
    TaskGet: 'extended',
    TaskUpdate: 'extended',
    TaskList: 'extended',
    TaskStop: 'extended',
    NotebookEdit: 'extended',
    Skill: 'extended',
    EnterPlanMode: 'extended',
    ExitPlanMode: 'extended',
    Sleep: 'extended',
    CtxInspect: 'extended',
    Workflow: 'extended',
    DesignSync: 'extended',
    CronCreate: 'extended',
    CronDelete: 'extended',
    CronList: 'extended',
    ScheduleWakeup: 'extended',
    ReportFindings: 'extended',
    BriefTool: 'extended',
    CreateArtifact: 'extended',
    UpdateArtifact: 'extended',
    ToolSearch: 'extended',
    ListMcpResources: 'deferred',
    ReadMcpResource: 'deferred',
}

export function classifyToolTier(toolName: string): ToolTier {
    const mcpPrefix = 'mcp__'
    if (toolName.startsWith(mcpPrefix)) return 'deferred'
    return TOOL_TIER_MAP[toolName] ?? 'deferred'
}

export function getToolsForTier(tier: ToolTier): string[] {
    return Object.entries(TOOL_TIER_MAP)
        .filter(([, t]) => {
            if (tier === 'core') return t === 'core'
            if (tier === 'standard') return t === 'core' || t === 'standard'
            if (tier === 'extended') return t === 'core' || t === 'standard' || t === 'extended'
            return true
        })
        .map(([name]) => name)
}

export function getEffectiveTierForMlx(): ToolTier {
    if (!isFusionMlxProvider()) return 'extended'
    try {
        const modelId = (getMainLoopModel() ?? '').toLowerCase()
        const sizeMatch = modelId.match(/(\d+\.?\d*)b/)
        if (!sizeMatch) return 'standard'
        const size = parseFloat(sizeMatch[1])
        if (size <= 3) return 'core'
        if (size <= 9) return 'standard'
        if (size <= 14) return 'extended'
        return 'extended'
    } catch {
        return 'standard'
    }
}

export function getDeferredToolNames(allToolNames: string[]): string[] {
    return allToolNames.filter(name => classifyToolTier(name) === 'deferred')
}

export function shouldLazyLoad(toolName: string, activeTier: ToolTier): boolean {
    const toolTier = classifyToolTier(toolName)
    if (toolTier === 'deferred') return true
    const tierOrder: ToolTier[] = ['core', 'standard', 'extended', 'deferred']
    return tierOrder.indexOf(toolTier) > tierOrder.indexOf(activeTier)
}

export function getTierInfo(): { tier: ToolTier; definition: typeof TIER_DEFINITIONS[ToolTier]; availableTools: string[] } {
    const tier = getEffectiveTierForMlx()
    return {
        tier,
        definition: TIER_DEFINITIONS[tier],
        availableTools: getToolsForTier(tier),
    }
}

const toolUsageMetrics: Map<string, { count: number; lastUsed: number }> = new Map()

export function recordToolUsage(toolName: string): void {
    const existing = toolUsageMetrics.get(toolName)
    if (existing) {
        existing.count++
        existing.lastUsed = Date.now()
    } else {
        toolUsageMetrics.set(toolName, { count: 1, lastUsed: Date.now() })
    }
}

export function getToolUsageMetrics(): Map<string, { count: number; lastUsed: number }> {
    return new Map(toolUsageMetrics)
}

export function getPromotionCandidates(activeTier: ToolTier): string[] {
    const candidates: string[] = []
    const tierOrder: ToolTier[] = ['core', 'standard', 'extended', 'deferred']
    const activeIdx = tierOrder.indexOf(activeTier)
    for (const [name, tier] of Object.entries(TOOL_TIER_MAP)) {
        if (tierOrder.indexOf(tier) > activeIdx) {
            const metrics = toolUsageMetrics.get(name)
            if (metrics && metrics.count >= 3) {
                candidates.push(name)
            }
        }
    }
    return candidates
}

export function formatToolDiscoveryReport(): string {
    const info = getTierInfo()
    const lines = [
        `Tool Discovery Report`,
        ``,
        `Active Tier: ${info.tier} (${info.definition.description})`,
        `Load Strategy: ${info.definition.loadStrategy}`,
        `Available Tools (${info.availableTools.length}):`,
    ]
    for (const name of info.availableTools.sort()) {
        const tier = classifyToolTier(name)
        lines.push(`  ${name} [${tier}]`)
    }
    const deferred = Object.entries(TOOL_TIER_MAP)
        .filter(([, t]) => t === 'deferred')
        .map(([n]) => n)
    if (deferred.length > 0) {
        lines.push('')
        lines.push(`Deferred Tools (${deferred.length}): loaded on first reference`)
        for (const name of deferred.sort()) {
            const metrics = toolUsageMetrics.get(name)
            const usage = metrics ? `used ${metrics.count}x` : 'not used'
            lines.push(`  ${name} (${usage})`)
        }
    }
    const candidates = getPromotionCandidates(info.tier)
    if (candidates.length > 0) {
        lines.push('')
        lines.push('Promotion Candidates (frequently used, consider promoting):')
        for (const name of candidates) {
            lines.push(`  ${name}`)
        }
    }
    return lines.join('\n')
}
