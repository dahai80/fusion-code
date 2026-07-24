import { logForDebugging } from '../../utils/debug.js'
import type { Command } from '../../types/command.js'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type WorkflowEntry = {
    name: string
    description: string
    filePath: string
}

const workflowCache: WorkflowEntry[] = []
let cacheValid = false

function getWorkflowDir(): string {
    return join(homedir(), '.claude', 'workflows')
}

async function scanWorkflowDir(): Promise<WorkflowEntry[]> {
    const dir = getWorkflowDir()
    const entries: WorkflowEntry[] = []
    try {
        const files = await readdir(dir)
        for (const file of files) {
            if (!file.endsWith('.js') && !file.endsWith('.ts') && !file.endsWith('.mjs')) {
                continue
            }
            const name = file.replace(/\.(js|ts|mjs)$/, '')
            entries.push({
                name,
                description: `User workflow: ${name}`,
                filePath: join(dir, file),
            })
        }
    } catch {
        logForDebugging('[workflow] no workflow directory found')
    }
    return entries
}

export async function getWorkflowCommands(): Promise<WorkflowEntry[]> {
    if (cacheValid) return workflowCache
    const entries = await scanWorkflowDir()
    workflowCache.length = 0
    workflowCache.push(...entries)
    cacheValid = true
    return workflowCache
}

export function invalidateWorkflowCache(): void {
    cacheValid = false
    workflowCache.length = 0
}

export function createWorkflowCommand(entry: WorkflowEntry): Command {
    return {
        type: 'local',
        name: entry.name,
        description: entry.description,
        isEnabled: () => true,
        isHidden: false,
        supportsNonInteractive: true,
        async load() {
            return {
                call: async (args: string, _context: unknown) => {
                    logForDebugging(`[workflow] running: ${entry.name}`)
                    try {
                        const mod = await import(entry.filePath)
                        if (typeof mod.default === 'function') {
                            const result = await mod.default(args)
                            return {
                                type: 'text' as const,
                                value: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                            }
                        }
                        return {
                            type: 'text' as const,
                            value: `Workflow "${entry.name}" loaded but has no default export function.`,
                        }
                    } catch (err) {
                        logForDebugging(`[workflow] error running ${entry.name}: ${(err as Error).message}`)
                        return {
                            type: 'text' as const,
                            value: `Failed to run workflow "${entry.name}": ${(err as Error).message}`,
                        }
                    }
                },
            }
        },
    }
}
