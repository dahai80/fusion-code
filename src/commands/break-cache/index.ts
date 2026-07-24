import type { Command, LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'

const call: LocalCommandCall = async () => {
    try {
        const { resetPromptCacheBreakDetection } = await import(
            '../../services/api/promptCacheBreakDetection.js'
        )
        resetPromptCacheBreakDetection()
        logForDebugging('[break-cache] Prompt cache break detection state reset')
        return {
            type: 'text',
            value: 'Prompt cache break detection state has been reset. The next API call will rebuild cache tracking from scratch.',
        }
    } catch (err) {
        return {
            type: 'text',
            value: `Failed to reset cache state: ${(err as Error).message}`,
        }
    }
}

const breakCache = {
    type: 'local',
    name: 'break-cache',
    description: 'Reset prompt cache break detection state, forcing cache tracking to rebuild on the next API call',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default breakCache
