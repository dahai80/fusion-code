import type { LocalJSXCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'

const ENV_KEY = 'FUSION_CODE_FOCUS_VIEW'

function isFocusViewEnabled(): boolean {
    return process.env[ENV_KEY] === '1'
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
    const trimmed = args.trim().toLowerCase()

    if (trimmed === 'on' || trimmed === 'enable' || trimmed === '1') {
        process.env[ENV_KEY] = '1'
        logForDebugging('[Focus] Enabled — verbose tool output hidden')
        onDone('Focus view ON — verbose tool output will be collapsed.')
        return null
    }

    if (trimmed === 'off' || trimmed === 'disable' || trimmed === '0') {
        process.env[ENV_KEY] = '0'
        logForDebugging('[Focus] Disabled — full tool output shown')
        onDone('Focus view OFF — showing full tool output.')
        return null
    }

    const current = isFocusViewEnabled()
    if (trimmed === 'status' || trimmed === '') {
        onDone(`Focus view is ${current ? 'ON' : 'OFF'}. Use /focus on|off to toggle.`)
        return null
    }

    process.env[ENV_KEY] = current ? '0' : '1'
    const newState = !current
    logForDebugging(`[Focus] Toggled to ${newState ? 'ON' : 'OFF'}`)
    onDone(`Focus view ${newState ? 'ON' : 'OFF'}.`)
    return null
}
