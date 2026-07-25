import type { LocalJSXCommandCall } from '../../types/command.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'
import { logForDebugging } from '../../utils/debug.js'

const ENV_KEY = 'FUSION_CODE_NO_FLICKER'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
    const trimmed = args.trim().toLowerCase()

    if (trimmed === 'on' || trimmed === 'enable' || trimmed === '1') {
        process.env[ENV_KEY] = '1'
        logForDebugging('[TUI] Enabled — flicker-free fullscreen active')
        onDone('TUI mode ON — flicker-free fullscreen rendering. Restart session for full effect.')
        return null
    }

    if (trimmed === 'off' || trimmed === 'disable' || trimmed === '0') {
        process.env[ENV_KEY] = '0'
        logForDebugging('[TUI] Disabled — standard rendering')
        onDone('TUI mode OFF — standard rendering. Restart session for full effect.')
        return null
    }

    const current = isFullscreenEnvEnabled()
    if (trimmed === 'status' || trimmed === '') {
        onDone(`TUI mode is ${current ? 'ON' : 'OFF'}. Use /tui on|off to toggle.`)
        return null
    }

    process.env[ENV_KEY] = current ? '0' : '1'
    const newState = !current
    logForDebugging(`[TUI] Toggled to ${newState ? 'ON' : 'OFF'}`)
    onDone(`TUI mode ${newState ? 'ON' : 'OFF'}. Restart session for full effect.`)
    return null
}
