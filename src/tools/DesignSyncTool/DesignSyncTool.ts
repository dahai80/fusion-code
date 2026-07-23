import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESIGN_SYNC_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'
import { logForDebugging } from '../../utils/debug.js'

const DESIGN_SYNC_METHODS = [
    'list_projects',
    'get_project',
    'list_files',
    'get_file',
    'create_project',
    'finalize_plan',
    'write_files',
    'delete_files',
    'register_assets',
    'unregister_assets',
    'report_validate',
] as const

const inputSchema = lazySchema(() =>
    z.strictObject({
        method: z
            .enum(DESIGN_SYNC_METHODS)
            .describe('The DesignSync API method to call'),
        projectId: z
            .string()
            .optional()
            .describe('Required for all methods except list_projects and create_project'),
        path: z
            .string()
            .optional()
            .describe('File path for get_file'),
        name: z
            .string()
            .optional()
            .describe('Name for create_project'),
        writes: z
            .array(z.string())
            .optional()
            .describe('Paths or glob patterns to write (finalize_plan)'),
        deletes: z
            .array(z.string())
            .optional()
            .describe('Paths or glob patterns to delete (finalize_plan)'),
        localDir: z
            .string()
            .optional()
            .describe('Local directory for finalize_plan'),
        planId: z
            .string()
            .optional()
            .describe('Plan ID from finalize_plan for write/delete operations'),
        files: z
            .array(z.object({
                path: z.string(),
                data: z.string().optional(),
                localPath: z.string().optional(),
                encoding: z.enum(['base64']).optional(),
                mimeType: z.string().optional(),
            }))
            .optional()
            .describe('Files to write (write_files)'),
        paths: z
            .array(z.string())
            .optional()
            .describe('Paths to delete (delete_files) or unregister (unregister_assets)'),
        assets: z
            .array(z.object({
                name: z.string(),
                path: z.string(),
                subtitle: z.string().optional(),
                viewport: z.object({ width: z.number(), height: z.number().optional() }).optional(),
                group: z.string().optional(),
            }))
            .optional()
            .describe('Assets to register (register_assets)'),
        counts: z
            .object({
                total: z.number(),
                bad: z.number(),
                thin: z.number(),
                variantsIdentical: z.number(),
                iterations: z.number(),
            })
            .optional()
            .describe('Aggregate counts for report_validate'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        method: z.string(),
        status: z.enum(['success', 'error', 'not_authenticated']),
        data: z.unknown().optional(),
        message: z.string().optional(),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const DesignSyncTool = buildTool({
    name: DESIGN_SYNC_TOOL_NAME,
    searchHint: 'sync design system components',
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
        logForDebugging(`[DesignSync] method=${input.method} project=${input.projectId || 'none'}`)

        return {
            data: {
                method: input.method,
                status: 'not_authenticated',
                message: 'DesignSync requires claude.ai authentication. Use /design-login to authenticate.',
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { method, status, message } = content as Output
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: message || `DesignSync ${method}: ${status}`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)
