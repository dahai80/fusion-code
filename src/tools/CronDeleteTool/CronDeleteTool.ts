import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { removeCronTasks } from '../../utils/cronTasks.js'
import { CRON_DELETE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
    z.strictObject({
        id: z
            .string()
            .describe('Job ID returned by CronCreate'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        deleted: z.boolean(),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const CronDeleteTool = buildTool({
    name: CRON_DELETE_TOOL_NAME,
    searchHint: 'cancel a scheduled cron job',
    maxResultSizeChars: 10_000,
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
    // log: execute signature expanded to match Tool type (5 params)
    async execute({ id }, _context, _canUseTool?, _parentMessage?, _onProgress?) {
        await removeCronTasks([id])
        return {
            data: {
                deleted: true,
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { deleted } = content as Output
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: deleted ? 'Job deleted' : 'Job not found',
        }
    },
} satisfies ToolDef<InputSchema, Output>)
