import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import type { ToolUseContext } from '../../Tool.js'
import { computeUndoSlice, checkUndoAvailability } from '../../services/undo/undoEngine.js'
import { logForDebugging } from '../../utils/debug.js'

export const call: LocalJSXCommandCall = async (
    onDone: LocalJSXCommandOnDone,
    context: ToolUseContext & { setMessages: (updater: (prev: any[]) => any[]) => void },
    args: string,
) => {
    const trimmed = args.trim()
    const count = parseInt(trimmed, 10)

    if (isNaN(count) || count <= 0) {
        onDone('Usage: /undo <N> — Undo N turns. Example: /undo 2')
        return null
    }

    // Use setMessages to read current messages and compute undo
    let currentMessages: any[] = []
    context.setMessages((prev: any[]) => {
        currentMessages = prev
        return prev
    })

    const availability = checkUndoAvailability(currentMessages)
    if (!availability.canUndo) {
        onDone('Nothing to undo. No anchor points found after the last compaction boundary.')
        return null
    }

    if (availability.compactionBoundary !== null) {
        const slice = computeUndoSlice(currentMessages, count)
        if (slice && slice.removeFrom <= availability.compactionBoundary) {
            onDone('Cannot undo past compaction boundary. The conversation was compacted and earlier history is no longer available.')
            return null
        }
    }

    const slice = computeUndoSlice(currentMessages, count)
    if (!slice) {
        onDone(`Cannot undo ${count} turn(s). Only ${availability.anchorCount} anchor(s) available.`)
        return null
    }

    // Apply the undo by truncating messages
    context.setMessages((prev: any[]) => prev.slice(0, slice.removeFrom))
    logForDebugging(`[undo] Rewound ${count} turn(s), removed from index ${slice.removeFrom}`)

    onDone(`Rewound ${count} turn(s). Removed everything after: "${slice.anchor.text.slice(0, 60)}..."`)
    return null
}
