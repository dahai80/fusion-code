import { z } from "zod/v4";
import { buildTool } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { DESCRIPTION, SLEEP_TOOL_NAME, SLEEP_TOOL_PROMPT } from "./prompt.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		duration: z
			.number()
			.min(1)
			.max(3600)
			.describe("Seconds to wait before waking up"),
		reason: z
			.string()
			.optional()
			.describe("Why you are sleeping (for user visibility)"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		Slept: z.boolean(),
		Duration: z.number(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Input = z.infer<InputSchema>;
export type Output = z.infer<OutputSchema>;

export const SleepTool = buildTool({
	name: SLEEP_TOOL_NAME,
	searchHint: "wait or sleep for a duration",
	maxResultSizeChars: 1000,
	shouldDefer: true,
	isConcurrencySafe() {
		return true;
	},
	isReadOnly() {
		return true;
	},
	toAutoClassifierInput(input: Input) {
		return `Sleep ${input.duration}s${input.reason ? ` ${input.reason}` : ""}`;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	async description() {
		return DESCRIPTION;
	},
	async prompt() {
		return SLEEP_TOOL_PROMPT;
	},
	async call(
		input: Input,
		context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		// log: fixed call signature
		const ms = input.duration * 1000;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			context.abortController.signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
		});
		return {
			data: {
				Slept: true,
				Duration: input.duration,
			},
		};
	},
	mapToolResultToToolResultBlockParam(output, toolUseID) {
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Slept ${output.Duration}s`,
		};
	},
});
