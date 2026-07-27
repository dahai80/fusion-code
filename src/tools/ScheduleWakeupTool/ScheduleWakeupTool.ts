import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { addCronTask } from "../../utils/cronTasks.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { SCHEDULE_WAKEUP_TOOL_NAME } from "./constants.js";
import { DESCRIPTION, getPrompt } from "./prompt.js";

const MIN_DELAY_S = 60;
const MAX_DELAY_S = 3600;

function delayToCron(delaySeconds: number): string {
	const clamped = Math.max(MIN_DELAY_S, Math.min(MAX_DELAY_S, delaySeconds));
	if (clamped < 3600) {
		const mins = Math.ceil(clamped / 60);
		const now = new Date();
		const fire = new Date(now.getTime() + mins * 60_000);
		return `${fire.getMinutes()} ${fire.getHours()} ${fire.getDate()} ${fire.getMonth() + 1} *`;
	}
	const hours = Math.round(clamped / 3600);
	const now = new Date();
	const fire = new Date(now.getTime() + hours * 3_600_000);
	return `${fire.getMinutes()} ${fire.getHours()} ${fire.getDate()} ${fire.getMonth() + 1} *`;
}

const inputSchema = lazySchema(() =>
	z.strictObject({
		delaySeconds: z
			.number()
			.min(MIN_DELAY_S)
			.max(MAX_DELAY_S)
			.optional()
			.describe(
				"Seconds from now to wake up. Clamped to [60, 3600]. Required unless stop is true.",
			),
		prompt: z
			.string()
			.optional()
			.describe(
				"The /loop input to fire on wake-up. Required unless stop is true. Use <<autonomous-loop-dynamic>> for autonomous loops.",
			),
		reason: z
			.string()
			.optional()
			.describe(
				"One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user.",
			),
		stop: z
			.boolean()
			.default(false)
			.describe(
				"Set to true to end the dynamic loop immediately instead of scheduling another wakeup.",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		jobId: z
			.string()
			.optional()
			.describe("Job ID from CronCreate, usable with CronDelete to cancel."),
		stopped: z.boolean().optional().describe("True when stop was requested."),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const ScheduleWakeupTool = buildTool({
	name: SCHEDULE_WAKEUP_TOOL_NAME,
	searchHint: "schedule a dynamic loop wakeup or stop the loop",
	maxResultSizeChars: 10_000,
	async description() {
		return DESCRIPTION;
	},
	async prompt() {
		return getPrompt();
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async execute(
		{ delaySeconds, prompt, reason, stop },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		// log: fixed execute signature
		if (stop) {
			return {
				data: { stopped: true },
			};
		}

		if (!delaySeconds || !prompt) {
			throw new Error(
				"delaySeconds and prompt are required when not stopping the loop.",
			);
		}

		const cron = delayToCron(delaySeconds);
		const id = await addCronTask(cron, prompt, false, false);

		const logReason = reason || `dynamic loop wakeup in ${delaySeconds}s`;
		console.log(`[ScheduleWakeup] ${logReason} → job ${id}`);

		return {
			data: {
				jobId: id,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const result = content as Output;
		if (result.stopped) {
			return {
				tool_use_id: toolUseID,
				type: "tool_result",
				content: "Dynamic loop stopped. No further wakeups scheduled.",
			};
		}
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Scheduled dynamic loop wakeup → job ${result.jobId}`,
		};
	},
});
