// Importers/callers: ArtifactCreateTool.ts, ArtifactUpdateTool.ts, artifactInjection.ts import getArtifactEngineURL
// Affected API: getArtifactEngineURL() replaces 3 separate hardcoded ARTIFACT_ENGINE_URL constants
// Data schemas: reads ~/.fusion/artifacts/config.yaml (same format as artifacts-engine default_config.yaml)
// User instruction: "所有的项目要有一个配置文件，配置类的卸载配置文件里面，不能写死在代码里面"

import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

let cachedURL: string | null = null

function parseYAMLSection(text: string, section: string): Record<string, string> {
    const result: Record<string, string> = {}
    const sectionRegex = new RegExp(`^${section}:\\s*$`, 'm')
    const match = sectionRegex.exec(text)
    if (!match) return result
    const afterSection = text.slice(match.index + match[0].length)
    const lines = afterSection.split('\n')
    for (const line of lines) {
        const trimmed = line.match(/^(\s{2,})\S/)
        if (!trimmed) break
        const kvMatch = line.match(/^\s+(\w+):\s*["']?(.*?)["']?\s*$/)
        if (kvMatch) {
            result[kvMatch[1]] = kvMatch[2]
        }
    }
    return result
}

export function getArtifactEngineURL(): string {
    if (cachedURL) return cachedURL

    if (process.env.ARTIFACT_ENGINE_URL) {
        cachedURL = process.env.ARTIFACT_ENGINE_URL
        return cachedURL
    }

    const configPath = process.env.FUSION_ARTIFACTS_CONFIG ||
        join(homedir(), '.fusion', 'artifacts', 'config.yaml')

    try {
        if (existsSync(configPath)) {
            const content = readFileSync(configPath, 'utf-8')
            const server = parseYAMLSection(content, 'server')
            const host = server.host || '127.0.0.1'
            const port = server.port || '8892'
            cachedURL = `http://${host}:${port}`
            return cachedURL
        }
    } catch {
        // Fall through to default
    }

    cachedURL = 'http://127.0.0.1:8892'
    return cachedURL
}

export function resetArtifactEngineURLCache(): void {
    cachedURL = null
}
