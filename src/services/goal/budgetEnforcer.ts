import { logForDebugging } from "../../utils/debug.js";
import {
	endOtelSpan,
	startOtelSpan,
} from "../../utils/telemetry/otelTracing.js";
import {
	formatBudgetUsage,
	getActiveGoal,
	isBudgetExceeded,
	pauseGoal,
} from "./goalState.js";

export type BudgetCheckResult = {
	exceeded: boolean;
	goalId: string | null;
	message: string | null;
};

export function checkBudget(sessionId: string): BudgetCheckResult {
	// P1.3: OTel budget funnel span (default-off, FUSION_CODE_OTEL_ENDPOINT).
	const otelBudgetSpan = startOtelSpan("fusion.budget.check", {
		"session.id": sessionId,
	});
	try {
		return checkBudgetInner(sessionId, otelBudgetSpan);
	} finally {
		endOtelSpan(otelBudgetSpan);
	}
}

function checkBudgetInner(
	sessionId: string,
	otelBudgetSpan: NonNullable<ReturnType<typeof startOtelSpan>>,
): BudgetCheckResult {
	const goal = getActiveGoal(sessionId);
	if (!goal) {
		return { exceeded: false, goalId: null, message: null };
	}
	const hasBudget =
		goal.budget.turns != null ||
		goal.budget.tokens != null ||
		goal.budget.wallMs != null;
	if (!hasBudget) {
		return { exceeded: false, goalId: goal.id, message: null };
	}
	if (otelBudgetSpan) {
		otelBudgetSpan.attrs["fusion.goal.id"] = goal.id;
	}
	if (!isBudgetExceeded(goal)) {
		return { exceeded: false, goalId: goal.id, message: null };
	}
	const paused = pauseGoal(sessionId, goal.id);
	if (paused) {
		const usage = formatBudgetUsage(goal);
		const msg = `Goal "${goal.objective}" budget exceeded (${usage}). Goal auto-paused.`;
		logForDebugging(`[BudgetEnforcer] ${msg}`);
		if (otelBudgetSpan) {
			otelBudgetSpan.attrs["fusion.budget.exceeded"] = true;
		}
		return { exceeded: true, goalId: goal.id, message: msg };
	}
	if (otelBudgetSpan) {
		otelBudgetSpan.attrs["fusion.budget.exceeded"] = true;
		otelBudgetSpan.attrs["fusion.budget.pause_failed"] = true;
	}
	return {
		exceeded: true,
		goalId: goal.id,
		message: "Budget exceeded but failed to pause goal",
	};
}
