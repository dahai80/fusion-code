// log: created for TS2307 fix

export type AssistantSession = {
    sessionId: string
    environmentId: string
    displayName?: string
    status?: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
    console.log('[sessionDiscovery] discoverAssistantSessions called')
    return []
}
