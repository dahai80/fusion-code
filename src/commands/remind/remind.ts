import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const REMINDER_TYPES = {
    git: {
        description: 'Before destructive git operations (push --force, reset --hard, rebase)',
        defaultEnabled: true,
    },
    scope: {
        description: 'When task creeps beyond original request',
        defaultEnabled: true,
    },
    context: {
        description: 'When conversation exceeds 50% context window',
        defaultEnabled: true,
    },
    security: {
        description: 'When handling secrets, credentials, env vars',
        defaultEnabled: true,
    },
    test: {
        description: 'When code changes lack test verification',
        defaultEnabled: false,
    },
} as const

type ReminderType = keyof typeof REMINDER_TYPES

interface ReminderConfig {
    enabled: Record<ReminderType, boolean>
}

function getConfigPath(): string {
    const configDir = getClaudeConfigHomeDir()
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
    }
    return join(configDir, 'reminders.json')
}

function loadConfig(): ReminderConfig {
    const configPath = getConfigPath()
    try {
        if (existsSync(configPath)) {
            const raw = readFileSync(configPath, 'utf-8')
            const parsed = JSON.parse(raw)
            const enabled = {} as Record<ReminderType, boolean>
            for (const key of Object.keys(REMINDER_TYPES) as ReminderType[]) {
                enabled[key] = parsed.enabled?.[key] ?? REMINDER_TYPES[key].defaultEnabled
            }
            return { enabled }
        }
    } catch (err) {
        logForDebugging(`[remind] failed to load config: ${err}`)
    }
    const enabled = {} as Record<ReminderType, boolean>
    for (const key of Object.keys(REMINDER_TYPES) as ReminderType[]) {
        enabled[key] = REMINDER_TYPES[key].defaultEnabled
    }
    return { enabled }
}

function saveConfig(config: ReminderConfig): void {
    const configPath = getConfigPath()
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    logForDebugging(`[remind] config saved to ${configPath}`)
}

export const call: LocalCommandCall = async (args, _context) => {
    const parts = args.trim().split(/\s+/)
    const action = parts[0]?.toLowerCase()
    const target = parts[1]?.toLowerCase() as ReminderType | undefined

    if (!action || action === 'list') {
        const config = loadConfig()
        const lines = Object.entries(REMINDER_TYPES).map(([key, val]) => {
            const isEnabled = config.enabled[key as ReminderType]
            const status = isEnabled ? '✓' : '✗'
            return `  ${status} ${key.padEnd(10)} ${val.description}`
        })
        return {
            type: 'text',
            value: `Runtime Reminders:\n${lines.join('\n')}\n\nUsage:\n  /remind enable <type>   Enable a reminder\n  /remind disable <type>  Disable a reminder\n  /remind list            Show this list`,
        } satisfies LocalCommandResult
    }

    if ((action === 'enable' || action === 'disable') && target) {
        if (!(target in REMINDER_TYPES)) {
            const available = Object.keys(REMINDER_TYPES).join(', ')
            return {
                type: 'text',
                value: `Unknown reminder type "${target}". Available: ${available}`,
            } satisfies LocalCommandResult
        }
        const config = loadConfig()
        config.enabled[target] = action === 'enable'
        saveConfig(config)
        console.log(`[remind] ${action}d ${target} reminder`)
        return {
            type: 'text',
            value: `${action === 'enable' ? 'Enabled' : 'Disabled'} ${target} reminder: ${REMINDER_TYPES[target].description}`,
        } satisfies LocalCommandResult
    }

    return {
        type: 'text',
        value: 'Usage: /remind <list|enable|disable> [type]',
    } satisfies LocalCommandResult
}
