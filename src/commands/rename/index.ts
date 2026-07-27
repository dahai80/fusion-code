import type { UUID } from 'crypto'
import { getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../types/command.js'
import {
    getTranscriptPath,
    saveAgentName,
    saveCustomTitle,
} from '../../utils/sessionStorage.js'

const rename: Command = {
    type: 'local-jsx',
    name: 'rename',
    description: 'Rename the current conversation',
    immediate: true,
    argumentHint: '[name]',
    async call(onDone, context, args) {
        const trimmedArgs = (args ?? '').trim()
        if (!trimmedArgs) {
            onDone(
                'Usage: /rename <name> — provide a name for the session',
                { type: 'display', display: 'system' },
            )
            return null
        }

        const newName = trimmedArgs
        const sessionId = getSessionId() as UUID
        const fullPath = getTranscriptPath()

        await saveCustomTitle(sessionId, newName, fullPath)
        await saveAgentName(sessionId, newName, fullPath)

        context.setAppState(prev => ({
            ...prev,
            standaloneAgentContext: {
                ...prev.standaloneAgentContext,
                name: newName,
            },
        }))

        onDone(`Session renamed to: ${newName}`, { type: 'display', display: 'system' })
        return null
    },
}

export default rename
