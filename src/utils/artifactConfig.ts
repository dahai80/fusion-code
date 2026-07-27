import { existsSync } from 'fs'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { parseYaml } from './yaml.js'

let cachedURL: string | null = null

export function getArtifactEngineURL(): string {
    if (cachedURL !== null) return cachedURL

    if (process.env.ARTIFACT_ENGINE_URL) {
        cachedURL = process.env.ARTIFACT_ENGINE_URL
        return cachedURL
    }

    const configPath = process.env.FUSION_ARTIFACTS_CONFIG ||
        join(getClaudeConfigHomeDir(), 'artifacts', 'config.yaml')

    try {
        if (existsSync(configPath)) {
            const content = readFileSync(configPath, 'utf-8')
            const parsed = parseYaml(content) as Record<string, Record<string, string>> | null
            const server = parsed?.server
            const host = server?.host || '127.0.0.1'
            const port = server?.port || '8892'
            cachedURL = `http://${host}:${port}`
            console.log(`[artifactConfig] loaded from ${configPath}: ${cachedURL}`)
            return cachedURL
        }
    } catch (e) {
        console.log(`[artifactConfig] failed to read ${configPath}: ${e}`)
    }

    cachedURL = 'http://127.0.0.1:8892'
    return cachedURL
}

export function resetArtifactEngineURLCache(): void {
    cachedURL = null
}
