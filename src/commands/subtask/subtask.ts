import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
    const trimmed = args.trim()

    if (!trimmed) {
        onDone('Usage: /subtask <description>\n\nSpawns an inline sub-agent to handle a specific task within the current session.')
        return null
    }

    logEvent('tengu_subtask', { description: 1 }) // log: analytics metadata must be number|boolean
    logForDebugging(`[Subtask] Creating subtask: ${trimmed}`)

    onDone(`Subtask: ${trimmed}`, {
        shouldQuery: true,
        nextInput: `Use the Agent tool to complete this subtask: ${trimmed}`,
        submitNextInput: true,
    })
    return null
}
