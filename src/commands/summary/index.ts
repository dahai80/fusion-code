import type { Command, LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'

const call: LocalCommandCall = async (args, context) => {
    try {
        const mutableMessages = context.messages
        if (!mutableMessages || mutableMessages.length === 0) {
            return { type: 'text', value: 'No conversation history to summarize.' }
        }

        const { generateAwaySummary } = await import(
            '../../services/awaySummary.js'
        )
        const summary = await generateAwaySummary(
            mutableMessages,
            context.abortController.signal,
        )
        logForDebugging('[summary] Generated session summary')
        return { type: 'text', value: summary || 'Unable to generate summary.' }
    } catch (err) {
        logForDebugging(`[summary] Error: ${(err as Error).message}`)
        return { type: 'text', value: `Failed to generate summary: ${(err as Error).message}` }
    }
}

const summary = {
    type: 'local',
    name: 'summary',
    description: 'Generate a summary of the current conversation session',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default summary
