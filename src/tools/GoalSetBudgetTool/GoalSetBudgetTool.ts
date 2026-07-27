import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	formatBudgetUsage,
	getActiveGoal,
	setGoalBudget,
} from "../../services/goal/goalState.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { GOAL_SET_BUDGET_TOOL_NAME } from "./constants.js";

const DESCRIPTION =
	"Set or update budget limits on a goal. When budget is exceeded, the goal auto-pauses and the turn stops.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		goalId: z
			.string()
			.optional()
			.describe("Goal ID. Omit to set budget on the active goal."),
		turns: z.number().optional().describe("Maximum number of turns"),
		tokens: z.number().optional().describe("Maximum number of tokens"),
		wallMs: z
			.number()
			.optional()
			.describe("Maximum wall-clock time in milliseconds"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		goalId: z.string().describe("The goal ID"),
		budget: z.string().describe("Updated budget summary"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const GoalSetBudgetTool = buildTool({
	name: GOAL_SET_BUDGET_TOOL_NAME,
	searchHint: "set budget limits on a goal",
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
	async execute({ goalId, turns, tokens, wallMs }, context) {
		const sessionId = getSessionId();
		let targetId = goalId;
		if (!targetId) {
			const active = getActiveGoal(sessionId);
			if (!active) {
				return {
					data: {
						goalId: "none",
						budget: "No active goal to set budget on",
					},
				};
			}
			targetId = active.id;
		}
		const budget: Record<string, number> = {};
		if (turns != null) budget.turns = turns;
		if (tokens != null) budget.tokens = tokens;
		if (wallMs != null) budget.wallMs = wallMs;
		const goal = setGoalBudget(sessionId, targetId, budget);
		if (!goal) {
			return {
				data: {
					goalId: targetId,
					budget: "Goal not found",
				},
			};
		}
		return {
			data: {
				goalId: goal.id,
				budget: formatBudgetUsage(goal),
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { goalId, budget } = content as Output;
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Budget set for goal ${goalId}: ${budget}`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
