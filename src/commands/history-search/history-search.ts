import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { sanitizeText } from '../../services/privacy/privacySanitizer.js'

interface TranscriptHit {
    sessionId: string
    project: string
    lineNum: number
    line: string
}

function searchTranscript(filePath: string, query: string, sessionId: string, project: string): TranscriptHit[] {
    const hits: TranscriptHit[] = []
    try {
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')
        const lowerQuery = query.toLowerCase()
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
                const sanitized = sanitizeText(lines[i].trim())
                hits.push({ sessionId, project, lineNum: i + 1, line: sanitized.slice(0, 200) })
            }
        }
    } catch {
        // skip unreadable files
    }
    return hits
}

export const call: LocalCommandCall = async (args, _context) => {
    const query = args.trim()
    if (!query) {
        return {
            type: 'text',
            value: 'Usage: /history-search <query>\n\nSearch past conversation transcripts for a keyword or phrase.',
        } satisfies LocalCommandResult
    }

    console.log(`[history-search] searching transcripts for: "${query}"`)
    const allHits: TranscriptHit[] = []
    const projectsDir = join(getClaudeConfigHomeDir(), 'projects')

    if (!existsSync(projectsDir)) {
        return {
            type: 'text',
            value: 'No conversation history found.',
        } satisfies LocalCommandResult
    }

    try {
        const projects = readdirSync(projectsDir, { withFileTypes: true })
        for (const proj of projects) {
            if (!proj.isDirectory()) continue
            const projDir = join(projectsDir, proj.name)
            try {
                const sessions = readdirSync(projDir, { withFileTypes: true })
                for (const session of sessions) {
                    if (!session.isDirectory()) continue
                    const sessionDir = join(projDir, session.name)
                    try {
                        const files = readdirSync(sessionDir)
                        for (const file of files) {
                            if (file.endsWith('.jsonl')) {
                                allHits.push(...searchTranscript(
                                    join(sessionDir, file),
                                    query,
                                    session.name,
                                    proj.name,
                                ))
                            }
                        }
                    } catch {
                        // skip unreadable session dirs
                    }
                }
                // Also check top-level .jsonl files (older format)
                try {
                    const topFiles = readdirSync(projDir)
                    for (const file of topFiles) {
                        if (file.endsWith('.jsonl')) {
                            const sessionId = file.replace('.jsonl', '')
                            allHits.push(...searchTranscript(
                                join(projDir, file),
                                query,
                                sessionId,
                                proj.name,
                            ))
                        }
                    }
                } catch {
                    // skip
                }
            } catch {
                // skip unreadable project dirs
            }
        }
    } catch {
        // skip
    }

    if (allHits.length === 0) {
        return {
            type: 'text',
            value: `No matches found for "${query}" in conversation transcripts.`,
        } satisfies LocalCommandResult
    }

    const output = allHits
        .slice(0, 30)
        .map(h => `[${h.project}/${h.sessionId}]:${h.lineNum}: ${h.line}`)
        .join('\n')

    const truncated = allHits.length > 30 ? `\n... and ${allHits.length - 30} more matches` : ''
    return {
        type: 'text',
        value: `Found ${allHits.length} match(es) for "${query}":\n${output}${truncated}`,
    } satisfies LocalCommandResult
}
