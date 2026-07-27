// log: created for TS2307 fix

import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'
import type { SettingSource } from '../../../utils/settings/constants.js' // log: fix TS2339

export type FinalAgentData = {
    agentType: string
    whenToUse: string
    getSystemPrompt: () => string
    tools?: string[]
    model?: string
    color?: AgentColorName
    source: SettingSource // log: fix TS2339
    memory?: AgentMemoryScope
}

export type AgentWizardData = {
    method?: 'generate' | 'manual'
    wasGenerated?: boolean
    agentType?: string
    generationPrompt?: string
    systemPrompt?: string
    whenToUse?: string
    location?: string
    selectedTools?: string[]
    selectedModel?: string
    selectedColor?: AgentColorName | null
    selectedMemory?: AgentMemoryScope
    isGenerating?: boolean
    finalAgent?: FinalAgentData
    generatedAgent?: FinalAgentData // log: fix TS2339 — used in GenerateStep
}
