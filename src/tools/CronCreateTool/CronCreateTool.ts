import { z } from "zod/v4";
import type { CanUseToolFn } from "../../hooks/useCanUseTool.js";
import {
	buildTool,
	type ToolCallProgress,
	type ToolDef,
	type ToolUseContext,
	type ValidationResult,
} from "../../Tool.js";
import type { AssistantMessage } from "../../types/message.js";
import { addCronTask } from "../../utils/cronTasks.js";
import { parseCronExpression } from "../../utils/cron.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { CRON_CREATE_TOOL_NAME } from "./constants.js";
import { DESCRIPTION, getPrompt } from "./prompt.js";

// P0-6: cap prompt length so a runaway model can't enqueue unbounded text per
// job (memory + log amplification). 8KiB is generous for any sane prompt and
// bounds the per-job footprint under the 50-job ceiling.
const CRON_PROMPT_MAX = 8192;

const inputSchema = lazySchema(() =>
	z.strictObject({
		cron: z
			.string()
			.describe(
				'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g., "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once)',
			),
		prompt: z
			.string()
			.max(CRON_PROMPT_MAX)
			.describe("The prompt to enqueue at each fire time."),
		recurring: z
			.boolean()
			.default(true)
			.describe(
				"true = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete.",
			),
		durable: z
			.boolean()
			.default(false)
			.describe(
				"true = persist to .claude/scheduled_tasks.json and survive restarts. false = in-memory only, dies when this session ends.",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		jobId: z.string().describe("Job ID you can pass to CronDelete"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const CronCreateTool = buildTool({
	name: CRON_CREATE_TOOL_NAME,
	searchHint: "schedule a cron job or reminder",
	maxResultSizeChars: 10_000,
	async description(_input: unknown, _options: unknown) {
		return DESCRIPTION;
	},
	async prompt(_options: unknown) {
		return getPrompt();
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	// P0-6: validate cron syntax before addCronTask accepts it. Without this an
	// invalid/garbage cron string is stored (DoS: jobs that never fire yet
	// occupy a slot, or scheduler walk cost on a huge bogus field). parseCronExpression
	// rejects non-5-field, out-of-range, and unsupported syntax.
	async validateInput(
		{ cron }: { cron: string; prompt: string; recurring: boolean; durable: boolean },
		_context: ToolUseContext,
	): Promise<ValidationResult> {
		if (parseCronExpression(cron) === null) {
			return {
				result: false,
				message: `Invalid cron expression "${cron}": must be a valid 5-field cron (minute hour day-of-month month day-of-week).`,
				errorCode: 1,
			};
		}
		return { result: true };
	},
	// log: execute signature expanded to match Tool type (5 params)
	async execute(
		{
			cron,
			prompt,
			recurring,
			durable,
		}: { cron: string; prompt: string; recurring: boolean; durable: boolean },
		_context: ToolUseContext,
		_canUseTool?: CanUseToolFn,
		_parentMessage?: AssistantMessage,
		_onProgress?: ToolCallProgress,
	) {
		const id = await addCronTask(cron, prompt, recurring, durable);

		return {
			data: {
				jobId: id,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content: unknown, toolUseID: string) {
		const { jobId } = content as Output;
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Scheduled job ${jobId}`,
		};
	},
} as ToolDef<InputSchema, Output>);
