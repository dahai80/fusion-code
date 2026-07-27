import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const PRIVACY_CONFIG_FILE = 'privacy.json'

interface PrivacyConfig {
    patterns: string[]
    enabled: boolean
}

const DEFAULT_CONFIG: PrivacyConfig = {
    patterns: [
        'password',
        'secret',
        'token',
        'api[_-]?key',
        'private[_-]?key',
        'credential',
        'auth[_-]?token',
        'access[_-]?token',
        'bearer',
        'cookie',
    ],
    enabled: true,
}

function getConfigPath(): string {
    return join(getClaudeConfigHomeDir(), PRIVACY_CONFIG_FILE)
}

export function loadPrivacyConfig(): PrivacyConfig {
    const configPath = getConfigPath()
    if (!existsSync(configPath)) {
        return { ...DEFAULT_CONFIG }
    }
    try {
        const raw = readFileSync(configPath, 'utf-8')
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } catch {
        return { ...DEFAULT_CONFIG }
    }
}

export function savePrivacyConfig(config: PrivacyConfig): void {
    const configPath = getConfigPath()
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function sanitizeText(text: string, config?: PrivacyConfig): string {
    const cfg = config ?? loadPrivacyConfig()
    if (!cfg.enabled) return text
    let result = text
    for (const pattern of cfg.patterns) {
        try {
            const regex = new RegExp(`(${pattern})['"\\s]*[:=]['"\\s]*[^\\s'"\\n]{4,}`, 'gi')
            result = result.replace(regex, '$1=***REDACTED***')
        } catch {
            // skip invalid regex patterns
        }
    }
    return result
}

export function addPrivacyPattern(pattern: string): void {
    const config = loadPrivacyConfig()
    if (!config.patterns.includes(pattern)) {
        config.patterns.push(pattern)
        savePrivacyConfig(config)
    }
}

export function removePrivacyPattern(pattern: string): void {
    const config = loadPrivacyConfig()
    config.patterns = config.patterns.filter(p => p !== pattern)
    savePrivacyConfig(config)
}

export function togglePrivacy(enabled: boolean): void {
    const config = loadPrivacyConfig()
    config.enabled = enabled
    savePrivacyConfig(config)
}
