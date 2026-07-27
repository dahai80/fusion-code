import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

type ReminderType = 'git' | 'scope' | 'context' | 'security' | 'test'

const DEFAULT_CONFIG: Record<ReminderType, boolean> = {
    git: true,
    scope: true,
    context: true,
    security: true,
    test: false,
}

const REMINDER_MESSAGES: Record<ReminderType, string> = {
    git: '[REMINDER] You are about to perform a destructive git operation. Verify the command, check for uncommitted changes, and confirm with the user if uncertain.',
    scope: "[REMINDER] This task may have expanded beyond the original request. Re-check the user's stated goal before continuing.",
    context: '[REMINDER] This conversation is getting long. Consider compacting or summarizing to preserve context quality.',
    security: '[REMINDER] You are handling sensitive data (secrets, credentials, env vars). Never log or display raw values. Use environment variable references instead.',
    test: '[REMINDER] Code changes were made without test verification. Consider adding or updating tests for the modified code.',
}

function loadReminderConfig(): Record<ReminderType, boolean> {
    const configPath = join(getClaudeConfigHomeDir(), 'reminders.json')
    try {
        if (existsSync(configPath)) {
            const raw = readFileSync(configPath, 'utf-8')
            const parsed = JSON.parse(raw)
            const result = {} as Record<ReminderType, boolean>
            for (const key of Object.keys(DEFAULT_CONFIG) as ReminderType[]) {
                result[key] = parsed.enabled?.[key] ?? DEFAULT_CONFIG[key]
            }
            return result
        }
    } catch (err) {
        logForDebugging(`[reminderClassifier] failed to load config: ${err}`)
    }
    return { ...DEFAULT_CONFIG }
}

export function getGitReminder(): string | null {
    const config = loadReminderConfig()
    return config.git ? REMINDER_MESSAGES.git : null
}

export function getScopeReminder(): string | null {
    const config = loadReminderConfig()
    return config.scope ? REMINDER_MESSAGES.scope : null
}

export function getContextReminder(): string | null {
    const config = loadReminderConfig()
    return config.context ? REMINDER_MESSAGES.context : null
}

export function getSecurityReminder(): string | null {
    const config = loadReminderConfig()
    return config.security ? REMINDER_MESSAGES.security : null
}

export function getTestReminder(): string | null {
    const config = loadReminderConfig()
    return config.test ? REMINDER_MESSAGES.test : null
}

export function getAllActiveReminders(): string[] {
    const config = loadReminderConfig()
    return (Object.keys(config) as ReminderType[])
        .filter(key => config[key])
        .map(key => REMINDER_MESSAGES[key])
}
