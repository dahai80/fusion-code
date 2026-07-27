import { logForDebugging } from '../../utils/debug.js'

export type SearchPolicy = 'never_search' | 'search_if_stale' | 'search_if_unsure' | 'always_search'

const SEARCH_TRIGGERS: Record<SearchPolicy, string[]> = {
    never_search: [],
    search_if_stale: [
        'version', 'latest', 'update', 'changelog', 'release',
        'deprecated', 'breaking change', 'migrated',
    ],
    search_if_unsure: [
        'api', 'library', 'package', 'import', 'module',
        'how to', 'best practice', 'recommended',
    ],
    always_search: [
        'current version of', 'what is the latest', 'is it possible to',
        'does it support', 'when was', 'who maintains',
    ],
}

const NEVER_SEARCH_PATTERNS = [
    'read file', 'show me the code', 'edit this', 'fix the error',
    'list files', 'git log', 'run test', 'build the project',
    'what does this function', 'explain this code',
]

export function classifySearchPolicy(input: string): SearchPolicy {
    const lower = input.toLowerCase()

    // Pure code operations never need search
    for (const pattern of NEVER_SEARCH_PATTERNS) {
        if (lower.includes(pattern)) return 'never_search'
    }

    // Always-search patterns take highest priority
    for (const keyword of SEARCH_TRIGGERS.always_search) {
        if (lower.includes(keyword)) return 'always_search'
    }

    // Stale-check patterns
    for (const keyword of SEARCH_TRIGGERS.search_if_stale) {
        if (lower.includes(keyword)) return 'search_if_stale'
    }

    // Unsure patterns
    for (const keyword of SEARCH_TRIGGERS.search_if_unsure) {
        if (lower.includes(keyword)) return 'search_if_unsure'
    }

    return 'never_search'
}

export interface SearchFirstResult {
    policy: SearchPolicy
    shouldSearch: boolean
    searchQuery: string
    reason: string
}

export function evaluateSearchFirst(input: string): SearchFirstResult {
    const policy = classifySearchPolicy(input)

    if (policy === 'never_search') {
        return { policy, shouldSearch: false, searchQuery: '', reason: 'Code/local operation detected' }
    }

    const searchQuery = extractSearchQuery(input)
    const shouldSearch = policy !== 'never_search'

    const reasons: Record<SearchPolicy, string> = {
        never_search: 'Code/local operation detected',
        search_if_stale: 'Version/currency-dependent query',
        search_if_unsure: 'API/library reference detected',
        always_search: 'Factual/current-state query',
    }

    logForDebugging(`[search-first] policy=${policy} query="${searchQuery}"`)
    return { policy, shouldSearch, searchQuery, reason: reasons[policy] }
}

function extractSearchQuery(input: string): string {
    let query = input
        .replace(/^(can you|could you|please|help me|i need to|how do i|what is|what are)\s*/i, '')
        .replace(/[?!.]+$/, '')
        .trim()

    if (query.length > 100) {
        query = query.slice(0, 100)
    }
    return query
}
