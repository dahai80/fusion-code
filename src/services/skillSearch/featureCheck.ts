// log: created for TS2307 fix

export function isFeatureEnabled(feature: string): boolean {
    return false
}

export type FeatureCheckResult = {
    enabled: boolean
    reason?: string
}
