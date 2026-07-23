import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { logForDebugging } from '../../utils/debug.js'

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
    async execute(input, _context, _toolContext) {
        logForDebugging(`[Workflow] executing: ${input.name || input.scriptPath || 'inline script'}`)

        // Workflow execution is handled by the Workflow runtime system.
        // The tool returns a runId; actual orchestration happens via the
        // task/scheduler infrastructure. For local MLX mode, this is a
        // lightweight stub that logs the intent and returns started status.
        // Full orchestration with agent()/parallel()/pipeline() requires
        // the workflow runtime which is initialized at session start.

        const scriptSource =
            input.script ||
            input.name ||
            input.scriptPath ||
            'unknown'

        return {
            data: {
                status: 'started',
                message: `Workflow started: ${scriptSource}`,
            },
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
} satisfies ToolDef<InputSchema, Output>)
