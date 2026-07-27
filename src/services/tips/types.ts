// log: created for TS2307 fix

export type TipContext = {
    theme?: unknown
    bashTools?: Set<string>
    readFileState?: unknown & {
        cacheKeys?: () => string[]
    }
}

export type Tip = {
    id: string
    content: (context?: TipContext) => Promise<string>
    cooldownSessions: number
    isRelevant?: (context?: TipContext) => Promise<boolean>
}
