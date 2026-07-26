import type { Command, LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { generateAwaySummary } from '../../services/awaySummary.js'

const call: LocalCommandCall = async (args, context) => {
    try {
        const mutableMessages = context.options.mutableMessages
        if (!mutableMessages || mutableMessages.length === 0) {
            return { type: 'text', value: 'No conversation history to recap.' }
        }

        const summary = await generateAwaySummary(
            mutableMessages,
            context.options.abortController?.signal,
        )
        logForDebugging('[recap] Generated session recap')
        return { type: 'text', value: summary || 'Unable to generate recap.' }
    } catch (err) {
        logForDebugging(`[recap] Error: ${(err as Error).message}`)
        return { type: 'text', value: `Failed to generate recap: ${(err as Error).message}` }
    }
}

const recap = {
    type: 'local',
    name: 'recap',
    description: 'Show a recap of the current session (useful when returning after a break)',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default recap
