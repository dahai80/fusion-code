import type { ToolPermissionContext } from '../../Tool.js'
import { logForDebugging } from '../debug.js'
import type { PermissionMode } from './PermissionMode.js'
import {
    isAutoModeGateEnabled,
    transitionPermissionMode,
} from './permissionSetup.js'

function canCycleToAuto(_ctx: ToolPermissionContext): boolean {
    const gateEnabled = isAutoModeGateEnabled()
    if (!gateEnabled) {
        logForDebugging(`[auto-mode] canCycleToAuto=false: isAutoModeGateEnabled=${gateEnabled}`)
    }
    return gateEnabled
}

/**
 * Determines the next permission mode when cycling through modes with Shift+Tab.
 *
 * External user cycle: default → auto → acceptEdits → plan → default
 * Ant user cycle: default → bypassPermissions/auto → default
 */
export function getNextPermissionMode(
    toolPermissionContext: ToolPermissionContext,
    _teamContext?: { leadAgentId: string },
): PermissionMode {
    switch (toolPermissionContext.mode) {
        case 'default':
            if (process.env.USER_TYPE === 'ant') {
                if (toolPermissionContext.isBypassPermissionsModeAvailable) {
                    return 'bypassPermissions'
                }
                if (canCycleToAuto(toolPermissionContext)) {
                    return 'auto'
                }
                return 'default'
            }
            // External users: default → auto
            if (canCycleToAuto(toolPermissionContext)) {
                return 'auto'
            }
            return 'acceptEdits'

        case 'auto':
            // External users: auto → acceptEdits
            if (process.env.USER_TYPE === 'ant') {
                return 'default'
            }
            return 'acceptEdits'

        case 'acceptEdits':
            return 'plan'

        case 'plan':
            if (toolPermissionContext.isBypassPermissionsModeAvailable) {
                return 'bypassPermissions'
            }
            if (canCycleToAuto(toolPermissionContext)) {
                return 'auto'
            }
            return 'default'

        case 'bypassPermissions':
            if (canCycleToAuto(toolPermissionContext)) {
                return 'auto'
            }
            return 'default'

        case 'dontAsk':
            return 'default'

        case 'readOnly':
            // Read-only is a terminal-ish restricted mode; cycle back to default.
            return 'default'

        default:
            return 'default'
    }
}

/**
 * Computes the next permission mode and prepares the context for it.
 * Handles any context cleanup needed for the target mode (e.g., stripping
 * dangerous permissions when entering auto mode).
 */
export function cyclePermissionMode(
    toolPermissionContext: ToolPermissionContext,
    teamContext?: { leadAgentId: string },
): { nextMode: PermissionMode; context: ToolPermissionContext } {
    const nextMode = getNextPermissionMode(toolPermissionContext, teamContext)
    return {
        nextMode,
        context: transitionPermissionMode(
            toolPermissionContext.mode,
            nextMode,
            toolPermissionContext,
        ),
    }
}
