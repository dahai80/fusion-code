import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	formatBudgetUsage,
	getActiveGoal,
	getGoalById,
	setGoalBudget,
} from "../../services/goal/index.js";
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
		expectedRevision: z
			.number()
			.int()
			.optional()
			.describe(
				"Compare-and-swap guard: the revision you last read via GoalGet. " +
					"If the stored revision differs, the update is rejected as stale.",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		goalId: z.string().describe("The goal ID"),
		budget: z.string().describe("Updated budget summary"),
		revision: z
			.number()
			.optional()
			.describe("New revision after update (for subsequent CAS calls)"),
		error: z.string().optional().describe("Error message if the update failed"),
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
	// log: execute signature expanded to match Tool type (5 params)
	async execute(
		{ goalId, turns, tokens, wallMs, expectedRevision },
		_context,
		_canUseTool?,
		_parentMessage?,
		_onProgress?,
	) {
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
		// P5.3 GoalRef CAS: reject stale concurrent writes when caller guards.
		// Omitted expectedRevision → no check (byte-identical to prior behavior).
		if (expectedRevision != null) {
			const current = getGoalById(sessionId, targetId);
			if (!current) {
				return {
					data: {
						goalId: targetId,
						budget: "Goal not found",
						error: `Goal ${targetId} not found`,
					},
				};
			}
			if (current.revision !== expectedRevision) {
				return {
					data: {
						goalId: targetId,
						budget: "stale revision",
						revision: current.revision,
						error: `Stale revision: expected ${expectedRevision} but current is ${current.revision}. Re-read the goal and retry.`,
					},
				};
			}
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
				revision: goal.revision,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { goalId, budget, revision, error } = content as Output;
		if (error) {
			return {
				tool_use_id: toolUseID,
				type: "tool_result",
				content: `Goal ${goalId}: ${error}`,
				is_error: true,
			};
		}
		const rev = revision != null ? ` (revision ${revision})` : "";
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Budget set for goal ${goalId}: ${budget}${rev}`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
