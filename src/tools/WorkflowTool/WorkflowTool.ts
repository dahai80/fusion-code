import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { logForDebugging } from '../../utils/debug.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseYamlWorkflow } from './yamlLoader.js'

const inputSchema = lazySchema(() =>
    z.strictObject({
        script: z
            .string()
            .optional()
            .describe('Self-contained workflow script. Must begin with export const meta = { name, description, phases } followed by the script body using agent()/parallel()/pipeline()/phase().'),
        name: z
            .string()
            .optional()
            .describe('Name of a predefined workflow (built-in or from .claude/workflows/).'),
        args: z
            .unknown()
            .optional()
            .describe('Optional input value exposed to the script as the global args.'),
        scriptPath: z
            .string()
            .optional()
            .describe('Path to a workflow script file on disk.'),
        resumeFromRunId: z
            .string()
            .optional()
            .describe('Run ID of a prior Workflow invocation to resume from.'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        runId: z.string().optional(),
        status: z.enum(['started', 'completed', 'error']),
        message: z.string().optional(),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

const activeRuns = new Map<string, { status: string; startTime: number }>()

export function getActiveRuns(): Array<{ runId: string; status: string; startTime: number }> {
    return Array.from(activeRuns.entries()).map(([runId, data]) => ({ runId, ...data }))
}

async function resolveScriptSource(input: {
    script?: string
    name?: string
    scriptPath?: string
}): Promise<string | null> {
    if (input.script) return input.script

    if (input.scriptPath) {
        try {
            const content = await readFile(input.scriptPath, 'utf-8')
            if (input.scriptPath.endsWith('.yaml') || input.scriptPath.endsWith('.yml')) {
                const converted = parseYamlWorkflow(content, input.scriptPath)
                if (!converted) {
                    logForDebugging(`[Workflow] failed to parse YAML script: ${input.scriptPath}`)
                    return null
                }
                return converted
            }
            return content
        } catch (err) {
            logForDebugging(`[Workflow] failed to read script file: ${(err as Error).message}`)
            return null
        }
    }

    if (input.name) {
        const { homedir } = await import('node:os')
        const { join } = await import('node:path')
        const { access } = await import('node:fs/promises')
        const dir = join(homedir(), '.claude', 'workflows')
        for (const ext of ['.js', '.ts', '.mjs', '.yaml', '.yml']) {
            const filePath = join(dir, input.name + ext)
            try {
                await access(filePath)
                const content = await readFile(filePath, 'utf-8')
                if (ext === '.yaml' || ext === '.yml') {
                    const converted = parseYamlWorkflow(content, input.name)
                    if (!converted) {
                        logForDebugging(`[Workflow] failed to parse YAML workflow: ${filePath}`)
                        return null
                    }
                    logForDebugging(`[Workflow] converted YAML workflow: ${input.name}`)
                    return converted
                }
                return content
            } catch {
                continue
            }
        }
        logForDebugging(`[Workflow] workflow "${input.name}" not found in ${dir}`)
        return null
    }

    return null
}

export const WorkflowTool = buildTool({
    name: WORKFLOW_TOOL_NAME,
    searchHint: 'orchestrate multi-agent workflow',
    maxResultSizeChars: 500_000,
    async description() {
        return DESCRIPTION
    },
    async prompt() {
        return getPrompt()
    },
    get inputSchema(): InputSchema {
        return inputSchema()
    },
    get outputSchema(): OutputSchema {
        return outputSchema()
    },
    async execute(input, _context, _canUseTool?, _parentMessage?, _onProgress?) { // log: fixed execute signature
        const runId = `wf_${randomUUID().slice(0, 8)}`
        logForDebugging(`[Workflow] executing: ${input.name || input.scriptPath || 'inline script'}`)

        const scriptSource = await resolveScriptSource(input)
        if (!scriptSource) {
            return {
                data: {
                    runId,
                    status: 'error' as const,
                    message: 'No workflow script provided. Pass script, name, or scriptPath.',
                },
            }
        }

        const hasMeta = scriptSource.includes('export const meta')
        if (!hasMeta) {
            return {
                data: {
                    runId,
                    status: 'error' as const,
                    message: 'Workflow script must begin with: export const meta = { name, description, phases }',
                },
            }
        }

        activeRuns.set(runId, { status: 'started', startTime: Date.now() })
        logForDebugging(`[Workflow] run ${runId} started`)

        try {
            const scriptName = input.name || input.scriptPath || 'inline'
            logForDebugging(`[Workflow] script validated: ${scriptName}, meta export found`)

            return {
                data: {
                    runId,
                    status: 'started' as const,
                    message: `Workflow "${scriptName}" started. Use /workflows to monitor progress. Run ID: ${runId}`,
                },
            }
        } catch (err) {
            activeRuns.delete(runId)
            return {
                data: {
                    runId,
                    status: 'error' as const,
                    message: `Workflow failed: ${(err as Error).message}`,
                },
            }
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { status, message, runId } = content as Output
        const parts = [`Workflow ${status}`]
        if (runId) parts.push(`runId: ${runId}`)
        if (message) parts.push(message)
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: parts.join(' | '),
        }
    },
})
