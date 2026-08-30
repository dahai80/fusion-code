import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import {
	blockGoal,
	completeGoal,
	getActiveGoal,
	getGoalById,
	getGoalQueue,
} from "../../services/goal/index.js";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { GOAL_UPDATE_TOOL_NAME } from "./constants.js";

const DESCRIPTION =
	"Update the status of a goal. Mark as complete or blocked. When a goal completes, the next queued goal auto-activates.";

const inputSchema = lazySchema(() =>
	z.strictObject({
		goalId: z
			.string()
			.optional()
			.describe("Goal ID. Omit to update the active goal."),
		status: z.enum(["complete", "blocked"]).describe("New status for the goal"),
		summary: z
			.string()
			.optional()
			.describe("Summary of what was accomplished or why blocked"),
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
		status: z.string().describe("Updated status"),
		nextGoalId: z
			.string()
			.optional()
			.describe("ID of the next auto-activated goal, if any"),
		queueRemaining: z.number().describe("Number of goals remaining in queue"),
		revision: z
			.number()
			.optional()
			.describe("New revision after update (for subsequent CAS calls)"),
		error: z.string().optional().describe("Error message if the update failed"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

export const GoalUpdateTool = buildTool({
	name: GOAL_UPDATE_TOOL_NAME,
	searchHint: "update goal status to complete or blocked",
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
		{ goalId, status, summary, expectedRevision },
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
						status: "No active goal",
						queueRemaining: 0,
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
						status: "Goal not found",
						queueRemaining: 0,
						error: `Goal ${targetId} not found`,
					},
				};
			}
			if (current.revision !== expectedRevision) {
				return {
					data: {
						goalId: targetId,
						status: "stale revision",
						queueRemaining: 0,
						revision: current.revision,
						error: `Stale revision: expected ${expectedRevision} but current is ${current.revision}. Re-read the goal and retry.`,
					},
				};
			}
		}
		let updated;
		if (status === "complete") {
			// P1-8: pass expectedRevision into the single load/save cycle so the CAS
			// check + mutation are atomic (previously getGoalById read + separate
			// completeGoal reload/save = TOCTOU window for concurrent writes).
			updated = completeGoal(sessionId, targetId, summary, expectedRevision);
		} else {
			updated = blockGoal(sessionId, targetId, summary, expectedRevision);
		}
		if (!updated) {
			return {
				data: {
					goalId: targetId,
					status: "update failed",
					queueRemaining: 0,
				},
			};
		}
		const queue = getGoalQueue(sessionId);
		const nextActive = queue.find((g) => g.status === "active");
		return {
			data: {
				goalId: targetId,
				status: updated.status,
				nextGoalId: nextActive?.id,
				queueRemaining: queue.filter((g) => g.status !== "complete").length,
				revision: updated.revision,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { goalId, status, nextGoalId, queueRemaining, revision, error } =
			content as Output;
		if (error) {
			return {
				tool_use_id: toolUseID,
				type: "tool_result",
				content: `Goal ${goalId}: ${error}`,
				is_error: true,
			};
		}
		const next = nextGoalId ? ` Next goal activated: ${nextGoalId}` : "";
		const rev = revision != null ? ` (revision ${revision})` : "";
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Goal ${goalId} updated to ${status}.${next} Queue remaining: ${queueRemaining}${rev}`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
