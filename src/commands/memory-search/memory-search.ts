import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, relative } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { homedir } from 'os'

interface MemoryHit {
    filePath: string
    relPath: string
    lineNum: number
    line: string
}

function searchInFile(filePath: string, query: string, relPath: string): MemoryHit[] {
    const hits: MemoryHit[] = []
    try {
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')
        const lowerQuery = query.toLowerCase()
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
                hits.push({ filePath, relPath, lineNum: i + 1, line: lines[i].trim() })
            }
        }
    } catch {
        // skip unreadable files
    }
    return hits
}

function walkDir(dir: string, query: string, basePath: string): MemoryHit[] {
    const hits: MemoryHit[] = []
    if (!existsSync(dir)) return hits
    try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = join(dir, entry.name)
            const rel = relative(basePath, fullPath)
            if (entry.isDirectory()) {
                hits.push(...walkDir(fullPath, query, basePath))
            } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.txt'))) {
                hits.push(...searchInFile(fullPath, query, rel))
            }
        }
    } catch {
        // skip unreadable directories
    }
    return hits
}

export const call: LocalCommandCall = async (args, _context) => {
    const query = args.trim()
    if (!query) {
        return {
            type: 'text',
            value: 'Usage: /memory-search <query>\n\nSearch all memory files for a keyword or phrase.',
        } satisfies LocalCommandResult
    }

    console.log(`[memory-search] searching for: "${query}"`)
    const allHits: MemoryHit[] = []

    // Search fusion-code global memory
    const fusionHome = getClaudeConfigHomeDir()
    const fusionMemoryDir = join(fusionHome, 'memory')
    allHits.push(...walkDir(fusionMemoryDir, query, fusionHome))

    // Search claude-style project memory directories
    const claudeProjectsDir = join(homedir(), '.claude', 'projects')
    if (existsSync(claudeProjectsDir)) {
        try {
            const projects = readdirSync(claudeProjectsDir, { withFileTypes: true })
            for (const proj of projects) {
                if (proj.isDirectory()) {
                    const memDir = join(claudeProjectsDir, proj.name, 'memory')
                    allHits.push(...walkDir(memDir, query, join(claudeProjectsDir, proj.name)))
                }
            }
        } catch {
            // skip
        }
    }

    if (allHits.length === 0) {
        return {
            type: 'text',
            value: `No matches found for "${query}" in memory files.`,
        } satisfies LocalCommandResult
    }

    const output = allHits
        .slice(0, 50)
        .map(h => `${h.relPath}:${h.lineNum}: ${h.line}`)
        .join('\n')

    const truncated = allHits.length > 50 ? `\n... and ${allHits.length - 50} more matches` : ''
    return {
        type: 'text',
        value: `Found ${allHits.length} match(es) for "${query}":\n${output}${truncated}`,
    } satisfies LocalCommandResult
}
