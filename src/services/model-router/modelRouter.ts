import { getAPIProvider } from '../../utils/model/providers.js'
import { logForDebugging } from '../../utils/debug.js'

export type TaskComplexity = 'trivial' | 'standard' | 'complex' | 'safety-critical'

export interface ModelTierConfig {
    tier: TaskComplexity
    localSmall: string
    localMain: string
    localLarge: string
    cloud: string
}

const DEFAULT_TIER_CONFIG: ModelTierConfig = {
    tier: 'standard',
    localSmall: 'qwen2.5-coder-0.5b',
    localMain: 'qwen2.5-coder',
    localLarge: 'qwen2.5-coder-32b',
    cloud: 'claude-sonnet-5',
}

const COMPLEXITY_KEYWORDS: Record<TaskComplexity, string[]> = {
    trivial: [
        'list', 'show', 'cat', 'head', 'tail', 'ls', 'pwd', 'status',
        'git log', 'git status', 'git diff', 'read', 'print', 'echo',
        'what is', 'where is', 'which', 'count',
    ],
    standard: [
        'edit', 'fix', 'change', 'update', 'rename', 'refactor',
        'add', 'remove', 'delete', 'move', 'copy', 'search',
        'implement', 'write', 'create', 'replace',
    ],
    complex: [
        'architecture', 'design', 'plan', 'debug', 'investigate',
        'analyze', 'optimize', 'migrate', 'integrate', 'review',
        'refactor entire', 'rewrite', 'explain why',
    ],
    'safety-critical': [
        'deploy', 'release', 'publish', 'merge to main', 'delete database',
        'drop table', 'rm -rf', 'format', 'nuke', 'production',
    ],
}

export function classifyTask(input: string): TaskComplexity {
    const lower = input.toLowerCase()

    // Check safety-critical first (highest priority)
    for (const keyword of COMPLEXITY_KEYWORDS['safety-critical']) {
        if (lower.includes(keyword)) return 'safety-critical'
    }

    // Check complex
    let complexScore = 0
    for (const keyword of COMPLEXITY_KEYWORDS.complex) {
        if (lower.includes(keyword)) complexScore++
    }

    // Check trivial
    let trivialScore = 0
    for (const keyword of COMPLEXITY_KEYWORDS.trivial) {
        if (lower.includes(keyword)) trivialScore++
    }

    // Length heuristic: long queries tend to be complex
    if (lower.length > 500) complexScore++

    if (complexScore > 0 && complexScore >= trivialScore) return 'complex'
    if (trivialScore > 0 && trivialScore > complexScore) return 'trivial'
    return 'standard'
}

export function resolveModelForTier(
    complexity: TaskComplexity,
    config?: Partial<ModelTierConfig>,
): string {
    const cfg = { ...DEFAULT_TIER_CONFIG, ...config }
    const provider = getAPIProvider()

    // Non-MLX providers always use their cloud model
    if (provider !== 'fusionMlx') {
        if (complexity === 'safety-critical') {
            logForDebugging(`[model-router] safety-critical task on cloud provider, using ${cfg.cloud}`)
        }
        return cfg.cloud
    }

    // MLX provider: route based on complexity
    switch (complexity) {
        case 'trivial':
            logForDebugging(`[model-router] trivial task → ${cfg.localSmall}`)
            return cfg.localSmall
        case 'standard':
            logForDebugging(`[model-router] standard task → ${cfg.localMain}`)
            return cfg.localMain
        case 'complex':
            logForDebugging(`[model-router] complex task → ${cfg.localLarge}`)
            return cfg.localLarge
        case 'safety-critical':
            if (provider === 'fusionMlx') {
                logForDebugging(`[model-router] safety-critical task on MLX → ${cfg.localLarge} (cloud unavailable)`)
                return cfg.localLarge
            }
            logForDebugging(`[model-router] safety-critical task → ${cfg.cloud}`)
            return cfg.cloud
    }
}

export interface ModelRouterResult {
    complexity: TaskComplexity
    model: string
    provider: string
    autoEscalate: boolean
}

export function routeModel(input: string, config?: Partial<ModelTierConfig>): ModelRouterResult {
    const complexity = classifyTask(input)
    const model = resolveModelForTier(complexity, config)
    const provider = getAPIProvider()
    const autoEscalate = complexity === 'complex' && provider === 'fusionMlx'

    return { complexity, model, provider, autoEscalate }
}
