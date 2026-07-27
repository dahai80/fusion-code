import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	createGoal,
	formatBudgetUsage,
} from "../../services/goal/goalState.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { GOAL_CREATE_TOOL_NAME } from "./constants.js";

const DESCRIPTION =
	"Create a new goal with optional budget limits. If no active goal exists, this becomes active; otherwise it is added to the queue.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		objective: z.string().describe("The goal objective to accomplish"),
		turns: z.number().optional().describe("Maximum number of turns allowed"),
		tokens: z.number().optional().describe("Maximum number of tokens allowed"),
		wallMs: z
			.number()
			.optional()
			.describe("Maximum wall-clock time in milliseconds"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		goalId: z.string().describe("The ID of the created goal"),
		status: z.string().describe("The status of the created goal"),
		budget: z.string().describe("Budget summary"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const GoalCreateTool = buildTool({
	name: GOAL_CREATE_TOOL_NAME,
	searchHint: "create a goal with budget limits",
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
		{ objective, turns, tokens, wallMs },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
		const sessionId = getSessionId();
		const budget = { turns, tokens, wallMs };
		const hasBudget = turns != null || tokens != null || wallMs != null;
		const goal = createGoal(
			sessionId,
			objective,
			hasBudget ? budget : undefined,
		);
		return {
			data: {
				goalId: goal.id,
				status: goal.status,
				budget: formatBudgetUsage(goal),
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { goalId, status, budget } = content as Output;
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Goal created: ${goalId} (status: ${status}, budget: ${budget})`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
