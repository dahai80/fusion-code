// log: created for TS2307 fix

export type AgentWizardData = {
    agentType: string
    location: string
    selectedModel?: string
    selectedTools: string[]
    systemPrompt: string
    whenToUse: string
    name?: string
    description?: string
    color?: string
    method?: string
    memoryPaths?: string[]
    finalAgent?: Record<string, unknown>
}
