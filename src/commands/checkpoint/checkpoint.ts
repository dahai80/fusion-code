import { appendFile, mkdir } from 'fs/promises'
import { execFileSync } from 'child_process'
import { join, dirname } from 'path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const CHECKPOINTS_LOG = '.claude/checkpoints.log'

async function getCheckpointsPath(cwd: string): Promise<string> {
    return join(cwd, CHECKPOINTS_LOG)
}

export const call: LocalCommandCall = async (args, context) => {
    const parts = args.trim().split(/\s+/)
    const action = parts[0] || 'create'
    const name = parts.slice(1).join(' ') || 'unnamed'
    const cwd = context.cwd || process.cwd()

    if (action === 'list') {
        return handleList(cwd)
    }

    if (action === 'verify') {
        return handleVerify(name, cwd)
    }

    return handleCreate(name, cwd)
}

async function handleCreate(name: string, cwd: string): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd)
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16)

    let gitRef = 'no-git'
    try {
        gitRef = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
    } catch {
        // not in a git repo, that's fine
    }

    const safeName = name.replace(/\|/g, '_')
    const entry = `${timestamp} | ${safeName} | ${gitRef}\n`

    await mkdir(dirname(logPath), { recursive: true })
    await appendFile(logPath, entry, 'utf-8')

    console.log(`[checkpoint] created "${name}" at ${gitRef}`)

    return {
        display: `Checkpoint "${name}" created at ${gitRef} (${timestamp})\nLog: ${logPath}`,
    } satisfies LocalCommandResult
}

async function handleList(cwd: string): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd)
    try {
        const { readFile } = await import('fs/promises')
        const content = await readFile(logPath, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)

        if (lines.length === 0) {
            return { display: 'No checkpoints found.' } satisfies LocalCommandResult
        }

        const header = 'Timestamp           | Name             | Git Ref'
        const separator = '--------------------+------------------+---------'
        const rows = lines.reverse().slice(0, 20).join('\n')

        return {
            display: `Checkpoints (last 20):\n${header}\n${separator}\n${rows}`,
        } satisfies LocalCommandResult
    } catch {
        return { display: 'No checkpoints found.' } satisfies LocalCommandResult
    }
}

async function handleVerify(name: string, cwd: string): Promise<LocalCommandResult> {
    const logPath = await getCheckpointsPath(cwd)
    try {
        const { readFile } = await import('fs/promises')
        const content = await readFile(logPath, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)

        const match = lines.find(l => l.includes(`| ${name} |`))
        if (!match) {
            return { display: `Checkpoint "${name}" not found. Use /checkpoint list to see all.` } satisfies LocalCommandResult
        }

        const parts = match.split(' | ').map(p => p.trim())
        const checkpointRef = parts[2] || 'unknown'

        let currentRef = 'no-git'
        try {
            currentRef = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
        } catch {
            // not in git
        }

        let diffStat = ''
        try {
            diffStat = execFileSync('git', ['diff', '--stat', `${checkpointRef}..HEAD`], { cwd, encoding: 'utf-8' }).trim()
        } catch {
            diffStat = 'Unable to compute diff'
        }

        console.log(`[checkpoint] verifying "${name}" (${checkpointRef} → ${currentRef})`)

        return {
            display: `Checkpoint: ${name}\nCreated at: ${parts[0]} (${checkpointRef})\nCurrent: ${currentRef}\n\nChanges since checkpoint:\n${diffStat || 'None'}`,
        } satisfies LocalCommandResult
    } catch {
        return { display: 'No checkpoints found.' } satisfies LocalCommandResult
    }
}
