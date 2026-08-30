import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import { registerDmailSummary } from "../../services/dmail/checkpointManager.js";
import { getActiveGoal } from "../../services/goal/index.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { logForDebugging } from "../../utils/debug.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { DMAIL_TOOL_NAME } from "./constants.js";

const DESCRIPTION =
	"Send a D-Mail to your future self: summarize what you have done so far so context can be compressed. Use when the context is getting large (big files read, failed code attempts, etc). Your future self will receive the summary and continue from a clean state.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		subject: z.string().describe("Short subject line for this D-Mail"),
		summary: z
			.string()
			.describe(
				"Summary of what you have done so far and what the next steps are. Be specific about file paths, function names, and any decisions made.",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		dmailId: z.string().describe("ID of the registered D-Mail"),
		status: z.string().describe("Result status"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const DMailTool = buildTool({
	name: DMAIL_TOOL_NAME,
	searchHint: "summarize context for compression via D-Mail",
	maxResultSizeChars: 10_000,
	async description() {
		return DESCRIPTION;
	},
	async prompt() {
		return DESCRIPTION;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	// log: execute signature expanded to match Tool type (5 params)
	async execute(
		{ subject, summary },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		const sessionId = getSessionId();

		const activeGoal = getActiveGoal(sessionId);
		const goalContext = activeGoal
			? `\n\nActive Goal: "${activeGoal.objective}" (status: ${activeGoal.status})`
			: "";

		const fullSummary = `[D-Mail from past self]\nSubject: ${subject}\n\n${summary}${goalContext}\n\n[End of D-Mail. Continue working from this summary.]`;

		const dmailId = registerDmailSummary(sessionId, subject, fullSummary);

		logForDebugging(`[D-Mail] Registered: "${subject}" (id: ${dmailId})`);

		return {
			data: {
				dmailId,
				status:
					"D-Mail registered. The summary will be available for context compression.",
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { dmailId, status } = content as Output;
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `D-Mail registered: ${dmailId}. ${status}`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
