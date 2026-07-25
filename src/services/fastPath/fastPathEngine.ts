import { logEvent } from '../analytics/index.js'
import { isFusionMlxProvider } from '../../utils/model/providers.js'

const LOG_PREFIX = '[fast-path]'

export interface FastPathResult {
    handled: boolean
    response: string | null
    ruleName: string | null
    durationMs: number
}

export interface FastPathRule {
    name: string
    match: (input: string) => boolean
    execute: (input: string) => string | null
}

const BUILT_IN_RULES: FastPathRule[] = [
    {
        name: 'version_query',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return /^(what('| i)?s? )?(version|ver|v)\s*(number)?$/.test(lower)
                || /^(show|print|display|get)\s+version$/.test(lower)
        },
        execute: (_input: string): string | null => {
            const v = process.env.FUSION_CODE_VERSION || 'unknown'
            return `Fusion-Code version: ${v}`
        },
    },
    {
        name: 'help_query',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return lower === 'help' || lower === '?' || lower === '/help'
                || lower === 'commands' || lower === 'what can you do'
        },
        execute: (_input: string): string | null => {
            return [
                'Available slash commands:',
                '  /ast        — Query AST symbol index',
                '  /compact    — Compact conversation history',
                '  /clear      — Clear conversation',
                '  /loop-test  — Self-correction test loop',
                '  /model      — Switch model',
                '  /status     — Show session status',
                '',
                'Type your question naturally, or use a slash command.',
            ].join('\n')
        },
    },
    {
        name: 'echo_test',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return lower.startsWith('echo ') && lower.length < 200
        },
        execute: (input: string): string | null => {
            const content = input.trim().slice(5)
            return content
        },
    },
    {
        name: 'env_check',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return /^(check|show|what('| i)?s? )?(env|environment)( variables)?$/.test(lower)
        },
        execute: (_input: string): string | null => {
            const keys = [
                'FUSION_API_KEY',
                'FUSION_MLX_ENABLED',
                'FUSION_MLX_MODEL',
                'FUSION_MODEL',
                'FUSION_BASE_URL',
                'HOME',
                'SHELL',
            ]
            const lines = keys.map(k => {
                const v = process.env[k]
                if (!v) return `  ${k}: (not set)`
                if (k.includes('KEY') || k.includes('TOKEN')) return `  ${k}: ${v.slice(0, 4)}...`
                return `  ${k}: ${v}`
            })
            return `Environment:\n${lines.join('\n')}`
        },
    },
    {
        name: 'json_format',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return /^(format|prettify|beautify)\s+(this\s+)?json\s*:/i.test(lower)
                || /^(format|prettify|beautify)\s+json$/i.test(lower)
        },
        execute: (input: string): string | null => {
            const jsonMatch = input.match(/:\s*([\[{].*)$/s)
            if (!jsonMatch) return 'No JSON payload found after colon.'
            try {
                const parsed = JSON.parse(jsonMatch[1])
                return JSON.stringify(parsed, null, 4)
            } catch (e: any) {
                return `Invalid JSON: ${e.message}`
            }
        },
    },
    {
        name: 'timestamp_query',
        match: (input: string): boolean => {
            const lower = input.toLowerCase().trim()
            return /^(what('| i)?s? )?(the )?(current )?(time|timestamp|date)/.test(lower)
        },
        execute: (_input: string): string | null => {
            const now = new Date()
            return [
                `Date: ${now.toISOString().split('T')[0]}`,
                `Time: ${now.toTimeString().split(' ')[0]}`,
                `ISO: ${now.toISOString()}`,
            ].join('\n')
        },
    },
]

export class FastPathEngine {
    private rules: FastPathRule[]
    private hitCounts: Map<string, number> = new Map()

    constructor(extraRules?: FastPathRule[]) {
        this.rules = [...BUILT_IN_RULES, ...(extraRules ?? [])]
    }

    evaluate(input: string): FastPathResult {
        const start = Date.now()

        if (!isFusionMlxProvider()) {
            return { handled: false, response: null, ruleName: null, durationMs: Date.now() - start }
        }

        const trimmed = input.trim()
        if (!trimmed || trimmed.startsWith('/')) {
            return { handled: false, response: null, ruleName: null, durationMs: Date.now() - start }
        }

        if (trimmed.length > 500) {
            return { handled: false, response: null, ruleName: null, durationMs: Date.now() - start }
        }

        for (const rule of this.rules) {
            try {
                if (rule.match(trimmed)) {
                    const result = rule.execute(trimmed)
                    if (result !== null) {
                        const durationMs = Date.now() - start
                        this.recordHit(rule.name)

                        console.log(
                            `${LOG_PREFIX} rule "${rule.name}" handled in ${durationMs}ms`,
                        )

                        logEvent('fast_path_hit', {
                            rule: rule.name,
                            duration_ms: durationMs,
                        })

                        return { handled: true, response: result, ruleName: rule.name, durationMs }
                    }
                }
            } catch (e) {
                console.log(`${LOG_PREFIX} rule "${rule.name}" error: ${e}`)
            }
        }

        return { handled: false, response: null, ruleName: null, durationMs: Date.now() - start }
    }

    addRule(rule: FastPathRule): void {
        this.rules.push(rule)
    }

    removeRule(name: string): boolean {
        const idx = this.rules.findIndex(r => r.name === name)
        if (idx >= 0) {
            this.rules.splice(idx, 1)
            return true
        }
        return false
    }

    getStats(): { rules: number; hits: Record<string, number> } {
        const hits: Record<string, number> = {}
        for (const [name, count] of this.hitCounts) {
            hits[name] = count
        }
        return { rules: this.rules.length, hits }
    }

    private recordHit(name: string): void {
        this.hitCounts.set(name, (this.hitCounts.get(name) ?? 0) + 1)
    }
}
