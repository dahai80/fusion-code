import type { LocalJSXCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'

function getGoalFilePath(): string {
    const configDir = process.env.FUSION_CODE_CONFIG_DIR || `${process.env.HOME}/.fusion-code`
    return `${configDir}/session-goal`
}

function readGoal(): string | null {
    try {
        const fs = require('fs')
        const path = getGoalFilePath()
        if (fs.existsSync(path)) {
            return fs.readFileSync(path, 'utf-8').trim() || null
        }
    } catch (e) {
        logForDebugging(`[Goal] Failed to read goal: ${(e as Error).message}`)
    }
    return null
}

function writeGoal(text: string): void {
    try {
        const fs = require('fs')
        const path = getGoalFilePath()
        const dir = path.substring(0, path.lastIndexOf('/'))
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(path, text.trim(), 'utf-8')
        logForDebugging(`[Goal] Set: ${text.trim().slice(0, 80)}`)
    } catch (e) {
        logForDebugging(`[Goal] Failed to write goal: ${(e as Error).message}`)
    }
}

function clearGoal(): void {
    try {
        const fs = require('fs')
        const path = getGoalFilePath()
        if (fs.existsSync(path)) {
            fs.unlinkSync(path)
            logForDebugging('[Goal] Cleared')
        }
    } catch (e) {
        logForDebugging(`[Goal] Failed to clear goal: ${(e as Error).message}`)
    }
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
    const trimmed = args.trim()

    if (trimmed === 'clear' || trimmed === 'reset' || trimmed === 'delete') {
        clearGoal()
        onDone('Session goal cleared.')
        return null
    }

    if (!trimmed) {
        const current = readGoal()
        if (current) {
            onDone(`Current goal: ${current}`)
        } else {
            onDone('No session goal set. Use /goal <text> to set one.')
        }
        return null
    }

    writeGoal(trimmed)
    onDone(`Session goal set: ${trimmed}`)
    return null
}
