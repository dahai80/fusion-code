import type { Message } from '../types/message.js'
import { logError } from './log.js'

const ARTIFACT_ENGINE_URL = process.env.ARTIFACT_ENGINE_URL || 'http://127.0.0.1:8900'

const REF_PATTERN = /\[Artifact:\s*[^\]]*?\|\s*ID:\s*(art_\w+)\s*\|[^\]]*\]/g

interface InjectionResult {
    messages: Message[]
    injectedCount: number
    totalTokensInjected: number
}

async function artifactsRPC(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    const resp = await fetch(ARTIFACT_ENGINE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return {}
    const json = (await resp.json()) as Record<string, unknown>
    if (json.error) return {}
    return (json.result as Record<string, unknown>) ?? {}
}

function isArtifactsEngineAvailable(): boolean {
    return process.env.ARTIFACT_ENGINE_DISABLED !== '1'
}

function extractArtifactIds(text: string): string[] {
    const ids: string[] = []
    let match: RegExpExecArray | null
    const pattern = new RegExp(REF_PATTERN.source, 'g')
    while ((match = pattern.exec(text)) !== null) {
        ids.push(match[1])
    }
    return ids
}

async function fetchArtifactContent(artifactId: string): Promise<{ content: string; name: string; type: string } | null> {
    try {
        const result = await artifactsRPC('artifact.get_content', { artifact_id: artifactId })
        if (result.content && typeof result.content === 'string') {
            return {
                content: result.content as string,
                name: (result.name as string) ?? artifactId,
                type: (result.type as string) ?? 'code',
            }
        }
        return null
    } catch (err) {
        logError(new Error(`artifact injection fetch failed for ${artifactId}: ${err}`))
        return null
    }
}

function wrapContentInCodeBlock(content: string, name: string, type: string): string {
    const langMap: Record<string, string> = {
        code: '',
        markdown: 'markdown',
        html: 'html',
        react: 'jsx',
        data: 'json',
    }
    const lang = langMap[type] ?? ''
    return `\n\`\`\`${lang}\n// Artifact: ${name}\n${content}\n\`\`\`\n`
}

export async function injectArtifactsIntoMessages(messages: Message[]): Promise<InjectionResult> {
    if (!isArtifactsEngineAvailable()) {
        return { messages, injectedCount: 0, totalTokensInjected: 0 }
    }

    let injectedCount = 0
    let totalTokensInjected = 0
    const contentCache = new Map<string, string>()

    const processedMessages = await Promise.all(
        messages.map(async (msg): Promise<Message> => {
            if (msg.type !== 'user' && msg.type !== 'assistant') return msg

            const content = typeof msg.content === 'string' ? msg.content : ''
            const artifactIds = extractArtifactIds(content)
            if (artifactIds.length === 0) return msg

            let newContent = content
            for (const artId of artifactIds) {
                if (!contentCache.has(artId)) {
                    const artifact = await fetchArtifactContent(artId)
                    if (artifact) {
                        contentCache.set(artId, wrapContentInCodeBlock(artifact.content, artifact.name, artifact.type))
                    }
                }
                const replacement = contentCache.get(artId)
                if (replacement) {
                    const refRegex = new RegExp(
                        `\\[Artifact:\\s*[^\\]]*?\\|\\s*ID:\\s*${artId}\\s*\\|[^\\]]*\\]`,
                        'g',
                    )
                    newContent = newContent.replace(refRegex, replacement)
                    injectedCount++
                    totalTokensInjected += Math.ceil(replacement.length / 4)
                }
            }

            if (newContent === content) return msg

            if (msg.type === 'user' && Array.isArray(msg.content)) {
                const blocks = msg.content.map(block => {
                    if (block.type === 'text' && typeof block.text === 'string') {
                        const ids = extractArtifactIds(block.text)
                        if (ids.length === 0) return block
                        let text = block.text
                        for (const artId of ids) {
                            const replacement = contentCache.get(artId)
                            if (replacement) {
                                const refRegex = new RegExp(
                                    `\\[Artifact:\\s*[^\\]]*?\\|\\s*ID:\\s*${artId}\\s*\\|[^\\]]*\\]`,
                                    'g',
                                )
                                text = text.replace(refRegex, replacement)
                            }
                        }
                        return { ...block, text }
                    }
                    return block
                })
                return { ...msg, content: blocks } as Message
            }

            return { ...msg, content: newContent } as Message
        }),
    )

    return { messages: processedMessages, injectedCount, totalTokensInjected }
}
