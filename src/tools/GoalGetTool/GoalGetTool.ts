import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	formatBudgetUsage,
	getActiveGoal,
	getGoalById,
	getGoalQueue,
	isBudgetExceeded,
} from "../../services/goal/goalState.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { GOAL_GET_TOOL_NAME } from "./constants.js";

const DESCRIPTION =
	"Get the status of the active goal or a specific goal by ID. Shows objective, status, and budget usage.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		goalId: z
			.string()
			.optional()
			.describe("Goal ID to look up. Omit to get the active goal."),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		goalId: z.string().describe("The goal ID"),
		objective: z.string().describe("The goal objective"),
		status: z.string().describe("Current status"),
		budget: z.string().describe("Budget usage summary"),
		budgetExceeded: z.boolean().describe("Whether budget has been exceeded"),
		queueSize: z.number().describe("Total goals in queue"),
		revision: z
			.number()
			.describe(
				"Current revision — pass as expectedRevision to GoalUpdate/GoalSetBudget for compare-and-swap",
			),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const GoalGetTool = buildTool({
	name: GOAL_GET_TOOL_NAME,
	searchHint: "get goal status and budget usage",
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
		{ goalId },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		const sessionId = getSessionId();
		const goal = goalId
			? getGoalById(sessionId, goalId)
			: getActiveGoal(sessionId);
		if (!goal) {
			return {
				data: {
					goalId: "none",
					objective: "No active goal",
					status: "none",
					budget: "N/A",
					budgetExceeded: false,
					queueSize: 0,
					revision: 0,
				},
			};
		}
		const queue = getGoalQueue(sessionId);
		return {
			data: {
				goalId: goal.id,
				objective: goal.objective,
				status: goal.status,
				budget: formatBudgetUsage(goal),
				budgetExceeded: isBudgetExceeded(goal),
				queueSize: queue.length,
				revision: goal.revision,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const {
			goalId,
			objective,
			status,
			budget,
			budgetExceeded,
			queueSize,
			revision,
		} = content as Output;
		const exceeded = budgetExceeded ? " [BUDGET EXCEEDED]" : "";
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Goal ${goalId}: "${objective}" (status: ${status}, budget: ${budget}${exceeded}, queue: ${queueSize} goals, revision: ${revision})`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
