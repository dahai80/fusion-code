import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { listAllCronTasks, type CronTask } from '../../utils/cronTasks.js'
import { CRON_LIST_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        tasks: z.array(
            z.object({
                id: z.string(),
                cron: z.string(),
                prompt: z.string(),
                recurring: z.boolean(),
                durable: z.boolean().optional(),
            }),
        ),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const CronListTool = buildTool({
    name: CRON_LIST_TOOL_NAME,
    searchHint: 'list scheduled cron jobs',
    maxResultSizeChars: 50_000,
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
    async execute(_input, _context, _canUseTool?, _parentMessage?, _onProgress?) {
        const tasks = await listAllCronTasks()
        return {
            data: {
                tasks: tasks.map((t: CronTask) => ({
                    id: t.id,
                    cron: t.cron,
                    prompt: t.prompt,
                    recurring: t.recurring ?? true,
                    durable: t.durable,
                })),
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { tasks } = content as Output
        if (tasks.length === 0) {
            return {
                tool_use_id: toolUseID,
                type: 'tool_result',
                content: 'No scheduled jobs.',
            }
        }
        const lines = tasks.map(
            t => `${t.id} | ${t.cron} | ${t.recurring ? 'recurring' : 'once'} | ${t.prompt.slice(0, 60)}`,
        )
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: `Scheduled jobs:\n${lines.join('\n')}`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)
