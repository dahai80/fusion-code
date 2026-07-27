import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'

// Track runtime override separate from the CLI-mandated env var,
// so toggling OFF via command doesn't undo a --ax-screen-reader flag.
declare global {
    // eslint-disable-next-line no-var
    var __fusionScreenReaderOverride: boolean | undefined
}

export async function call(
    onDone: LocalJSXCommandOnDone,
    context: ToolUseContext & LocalJSXCommandContext,
    _args: string,
): Promise<null> {
    const current = context.getAppState().settings.prefersReducedMotion ?? false
    const next = !current

    // Set runtime override flag — getInitialSettings() checks this too
    globalThis.__fusionScreenReaderOverride = next

    logForDebugging(`[ScreenReader] Toggled ${next ? 'ON' : 'OFF'} via /screen-reader command`)

    // Update AppState so all consumers (Spinner, TextInput, etc.) react immediately
    context.setAppState(prev => ({
        ...prev,
        settings: {
            ...prev.settings,
            prefersReducedMotion: next,
        },
    }))

    onDone(
        next
            ? 'Screen reader mode ON: animations disabled, plain text status'
            : 'Screen reader mode OFF: animations restored',
        { display: 'system' }, // log: removed 'type' - not in LocalJSXCommandOnDone options
    )
    return null
}
