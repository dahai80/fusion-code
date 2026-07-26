import * as React from 'react'
import { handlePlanModeTransition } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js'

export async function call(
    onDone: LocalJSXCommandOnDone,
    context: LocalJSXCommandContext,
    _args: string,
): Promise<React.ReactNode> {
    const { getAppState, setAppState } = context
    const appState = getAppState()
    const currentMode = appState.toolPermissionContext.mode

    if (currentMode === 'plan') {
        handlePlanModeTransition(currentMode, 'default')
        setAppState(prev => ({
            ...prev,
            toolPermissionContext: applyPermissionUpdate(
                prepareContextForPlanMode(prev.toolPermissionContext),
                { type: 'setMode', mode: 'default', destination: 'session' },
            ),
        }))
        console.log('[act] switched from plan mode to act mode')
        onDone('Switched to act mode — all tools enabled', {
            shouldQuery: true,
        })
        return null
    }

    console.log(`[act] already in act mode (current: ${currentMode})`)
    onDone('Already in act mode — all tools enabled')
    return null
}
