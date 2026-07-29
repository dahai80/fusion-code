/**
 * Portable CLAUDE.md parsing — no CLI dependencies.
 *
 * Accepts cwd as parameter instead of reading bootstrap/state.
 * No hooks, no analytics, no memoize, no feature flags.
 * Designed for use by the project API server and external consumers.
 */

import { readFile, readdir, stat } from 'fs/promises'
import { dirname, join, parse } from 'path'
import { parseFrontmatter } from './frontmatterParser.js'
import { logForDebugging } from './debug.js'

export type PortableMemoryFileInfo = {
    path: string
    type: 'Managed' | 'User' | 'Project' | 'Local' | 'AutoMem'
    content: string
    description: string | null
    frontmatter: Record<string, unknown>
}

export type PortableProjectContext = {
    cwd: string
    files: PortableMemoryFileInfo[]
    combinedContent: string
}

const MAX_FILE_SIZE = 40000

async function fileExists(filePath: string): Promise<boolean> {
    try {
        const s = await stat(filePath)
        return s.isFile()
    } catch {
        return false
    }
}

async function dirExists(dirPath: string): Promise<boolean> {
    try {
        const s = await stat(dirPath)
        return s.isDirectory()
    } catch {
        return false
    }
}

async function readMemoryFile(
    filePath: string,
    type: PortableMemoryFileInfo['type'],
): Promise<PortableMemoryFileInfo | null> {
    try {
        const content = await readFile(filePath, 'utf-8')
        if (!content.trim()) return null
        const { frontmatter, content: body } = parseFrontmatter(content, filePath)
        return {
            path: filePath,
            type,
            content: body.slice(0, MAX_FILE_SIZE),
            description: (frontmatter.description as string) ?? null,
            frontmatter: frontmatter as Record<string, unknown>,
        }
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES') return null
        logForDebugging(`claudemdPortable: failed to read ${filePath}: ${code ?? e}`)
        return null
    }
}

async function readRulesDir(
    rulesDir: string,
    type: PortableMemoryFileInfo['type'],
): Promise<PortableMemoryFileInfo[]> {
    if (!(await dirExists(rulesDir))) return []
    const results: PortableMemoryFileInfo[] = []
    try {
        const entries = await readdir(rulesDir, { recursive: true })
        for (const entry of entries) {
            if (typeof entry !== 'string' || !entry.endsWith('.md')) continue
            const filePath = join(rulesDir, entry)
            const info = await readMemoryFile(filePath, type)
            if (info) results.push(info)
        }
    } catch {
        return []
    }
    return results
}

function getAncestorDirs(cwd: string): string[] {
    const dirs: string[] = []
    let current = cwd
    const root = parse(current).root
    while (current !== root) {
        dirs.push(current)
        const parent = dirname(current)
        if (parent === current) break
        current = parent
    }
    return dirs
}

export async function getMemoryFilesPortable(
    cwd: string,
): Promise<PortableMemoryFileInfo[]> {
    const result: PortableMemoryFileInfo[] = []

    // User-level: ~/.fusion-code/CLAUDE.md + ~/.fusion-code/rules/*.md
    const { homedir } = await import('os')
    const configHome =
        process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), '.fusion-code')
    const userClaudeMd = join(configHome, 'CLAUDE.md')
    const userInfo = await readMemoryFile(userClaudeMd, 'User')
    if (userInfo) result.push(userInfo)
    result.push(...(await readRulesDir(join(configHome, 'rules'), 'User')))

    // Project-level: walk from root to cwd
    const dirs = getAncestorDirs(cwd).reverse()
    for (const dir of dirs) {
        // CLAUDE.md (Project)
        const projectInfo = await readMemoryFile(join(dir, 'CLAUDE.md'), 'Project')
        if (projectInfo) result.push(projectInfo)

        // .fusion-code/CLAUDE.md (Project)
        const dotClaudeInfo = await readMemoryFile(
            join(dir, '.fusion-code', 'CLAUDE.md'),
            'Project',
        )
        if (dotClaudeInfo) result.push(dotClaudeInfo)

        // .fusion-code/rules/*.md (Project)
        result.push(
            ...(await readRulesDir(join(dir, '.fusion-code', 'rules'), 'Project')),
        )

        // CLAUDE.local.md (Local)
        const localInfo = await readMemoryFile(
            join(dir, 'CLAUDE.local.md'),
            'Local',
        )
        if (localInfo) result.push(localInfo)
    }

    return result
}

export async function getProjectContextPortable(
    cwd: string,
): Promise<PortableProjectContext> {
    const files = await getMemoryFilesPortable(cwd)
    const combinedContent = files
        .filter(f => f.content.trim())
        .map(f => {
            const desc =
                f.type === 'Project'
                    ? ' (project instructions)'
                    : f.type === 'Local'
                      ? " (user's private project instructions)"
                      : f.type === 'AutoMem'
                        ? ' (auto-memory)'
                        : " (user's global instructions)"
            return `Contents of ${f.path}${desc}:\n\n${f.content.trim()}`
        })
        .join('\n\n')

    return { cwd, files, combinedContent }
}
