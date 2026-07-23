import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { addCronTask } from '../../utils/cronTasks.js'
import { CRON_CREATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const inputSchema = lazySchema(() =>
    z.strictObject({
        cron: z
            .string()
            .describe(
                'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g., "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once)',
            ),
        prompt: z.string().describe('The prompt to enqueue at each fire time.'),
        recurring: z
            .boolean()
            .default(true)
            .describe(
                'true = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete.',
            ),
        durable: z
            .boolean()
            .default(false)
            .describe(
                'true = persist to .claude/scheduled_tasks.json and survive restarts. false = in-memory only, dies when this session ends.',
            ),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        jobId: z.string().describe('Job ID you can pass to CronDelete'),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const CronCreateTool = buildTool({
    name: CRON_CREATE_TOOL_NAME,
    searchHint: 'schedule a cron job or reminder',
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
    async execute(
        { cron, prompt, recurring, durable },
        _context,
        _toolContext,
    ) {
        const id = await addCronTask(cron, prompt, recurring, durable)

        return {
            data: {
                jobId: id,
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { jobId } = content as Output
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: `Scheduled job ${jobId}`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)
