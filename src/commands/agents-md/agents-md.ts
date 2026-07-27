import { existsSync, readFileSync } from 'fs'
import { dirname, join, sep } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'

function findAgentsMdFiles(startDir: string, rootDir: string): string[] {
    const files: string[] = []
    let current = startDir

    while (true) {
        const candidate = join(current, 'AGENTS.md')
        if (existsSync(candidate)) {
            files.push(candidate)
        }
        if (current === rootDir || current === dirname(current)) {
            break
        }
        current = dirname(current)
    }

    return files.reverse()
}

function resolveProjectRoot(startDir: string): string {
    const markers = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod']
    let current = startDir
    while (current !== dirname(current)) {
        for (const marker of markers) {
            if (existsSync(join(current, marker))) {
                return current
            }
        }
        current = dirname(current)
    }
    return startDir
}

export const call: LocalCommandCall = async (args, _context) => {
    const targetPath = args.trim() || getCwd()
    const projectRoot = resolveProjectRoot(targetPath)
    const agentsFiles = findAgentsMdFiles(targetPath, projectRoot)

    console.log(`[agents-md] scanning from ${targetPath} to ${projectRoot}, found ${agentsFiles.length} AGENTS.md files`)

    if (agentsFiles.length === 0) {
        return {
            type: 'text',
            value: `No AGENTS.md files found between:\n  ${targetPath}\n  → ${projectRoot}\n\nCreate one with: echo "# Rules" > AGENTS.md`,
        } satisfies LocalCommandResult
    }

    const sections = agentsFiles.map((filePath, idx) => {
        const content = readFileSync(filePath, 'utf-8').trim()
        const relPath = filePath.replace(projectRoot + sep, '')
        const priority = agentsFiles.length - idx
        return `━━━ [${relPath}] (priority ${priority}) ━━━\n${content}`
    })

    const header = `Effective AGENTS.md rules for: ${targetPath.replace(projectRoot + sep, '') || '.'}\nProject root: ${projectRoot}\n`
    const merged = `${header}\n${sections.join('\n\n')}`

    return {
        type: 'text',
        value: merged,
    } satisfies LocalCommandResult
}
