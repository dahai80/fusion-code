import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { logForDebugging } from "../../utils/debug.js";

export type GoalStatus = "active" | "paused" | "blocked" | "complete";

export type GoalBudget = {
	turns?: number;
	tokens?: number;
	wallMs?: number;
};

export type GoalBudgetUsed = {
	turns: number;
	tokens: number;
	wallMs: number;
};

export type Goal = {
	id: string;
	objective: string;
	status: GoalStatus;
	budget: GoalBudget;
	budgetUsed: GoalBudgetUsed;
	createdAt: number;
	startedAt: number | null;
	pausedAt: number | null;
	completedAt: number | null;
	summary: string | null;
};

const MAX_OBJECTIVE_LENGTH = 4000;

function getConfigDir(): string {
	return (
		process.env.FUSION_CODE_CONFIG_DIR || `${process.env.HOME}/.fusion-code`
	);
}

function getGoalsDir(): string {
	return `${getConfigDir()}/goals`;
}

function getGoalsFilePath(sessionId: string): string {
	return `${getGoalsDir()}/${sessionId}.json`;
}

function generateGoalId(): string {
	return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadGoals(sessionId: string): Goal[] {
	try {
		const path = getGoalsFilePath(sessionId);
		if (existsSync(path)) {
			const raw = readFileSync(path, "utf-8").trim();
			if (raw) return JSON.parse(raw);
		}
	} catch (e) {
		logForDebugging(
			`[GoalState] Failed to load goals: ${(e as Error).message}`,
		);
	}
	return [];
}

function saveGoals(sessionId: string, goals: Goal[]): void {
	try {
		const dir = getGoalsDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const path = getGoalsFilePath(sessionId);
		writeFileSync(path, JSON.stringify(goals, null, 2), "utf-8");
	} catch (e) {
		logForDebugging(
			`[GoalState] Failed to save goals: ${(e as Error).message}`,
		);
	}
}

export function createGoal(
	sessionId: string,
	objective: string,
	budget?: GoalBudget,
): Goal {
	const goals = loadGoals(sessionId);
	if (objective.length > MAX_OBJECTIVE_LENGTH) {
		objective = objective.slice(0, MAX_OBJECTIVE_LENGTH);
	}
	const goal: Goal = {
		id: generateGoalId(),
		objective,
		status: goals.length === 0 ? "active" : "paused",
		budget: budget ?? {},
		budgetUsed: { turns: 0, tokens: 0, wallMs: 0 },
		createdAt: Date.now(),
		startedAt: goals.length === 0 ? Date.now() : null,
		pausedAt: goals.length === 0 ? null : Date.now(),
		completedAt: null,
		summary: null,
	};
	goals.push(goal);
	saveGoals(sessionId, goals);
	logForDebugging(
		`[GoalState] Created goal ${goal.id}: ${objective.slice(0, 60)} status=${goal.status}`,
	);
	return goal;
}

export function getActiveGoal(sessionId: string): Goal | null {
	const goals = loadGoals(sessionId);
	return goals.find((g) => g.status === "active") ?? null;
}

export function getGoalById(sessionId: string, goalId: string): Goal | null {
	const goals = loadGoals(sessionId);
	return goals.find((g) => g.id === goalId) ?? null;
}

export function getGoalQueue(sessionId: string): Goal[] {
	return loadGoals(sessionId);
}

export function pauseGoal(sessionId: string, goalId?: string): Goal | null {
	const goals = loadGoals(sessionId);
	const target = goalId
		? goals.find((g) => g.id === goalId)
		: goals.find((g) => g.status === "active");
	if (!target || target.status !== "active") return null;
	target.status = "paused";
	target.pausedAt = Date.now();
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Paused goal ${target.id}`);
	return target;
}

export function resumeGoal(sessionId: string, goalId?: string): Goal | null {
	const goals = loadGoals(sessionId);
	const target = goalId
		? goals.find((g) => g.id === goalId)
		: goals.find((g) => g.status === "paused");
	if (!target || target.status !== "paused") return null;
	const hasActive = goals.some((g) => g.status === "active");
	if (hasActive) return null;
	target.status = "active";
	target.pausedAt = null;
	target.startedAt = target.startedAt ?? Date.now();
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Resumed goal ${target.id}`);
	return target;
}

export function completeGoal(
	sessionId: string,
	goalId: string,
	summary?: string,
): Goal | null {
	const goals = loadGoals(sessionId);
	const idx = goals.findIndex((g) => g.id === goalId);
	if (idx === -1 || goals[idx].status === "complete") return null;
	goals[idx].status = "complete";
	goals[idx].completedAt = Date.now();
	goals[idx].summary = summary ?? null;
	const nextPaused = goals.find((g) => g.status === "paused");
	if (nextPaused) {
		nextPaused.status = "active";
		nextPaused.pausedAt = null;
		nextPaused.startedAt = nextPaused.startedAt ?? Date.now();
		logForDebugging(`[GoalState] Auto-activated next goal ${nextPaused.id}`);
	}
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Completed goal ${goalId}`);
	return goals[idx];
}

export function blockGoal(
	sessionId: string,
	goalId: string,
	summary?: string,
): Goal | null {
	const goals = loadGoals(sessionId);
	const idx = goals.findIndex((g) => g.id === goalId);
	if (idx === -1 || goals[idx].status !== "active") return null;
	goals[idx].status = "blocked";
	goals[idx].summary = summary ?? null;
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Blocked goal ${goalId}`);
	return goals[idx];
}

export function replaceGoal(
	sessionId: string,
	objective: string,
	budget?: GoalBudget,
): Goal | null {
	const goals = loadGoals(sessionId);
	const active = goals.find((g) => g.status === "active");
	if (!active) return null;
	if (objective.length > MAX_OBJECTIVE_LENGTH) {
		objective = objective.slice(0, MAX_OBJECTIVE_LENGTH);
	}
	active.objective = objective;
	if (budget) active.budget = budget;
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Replaced goal ${active.id} objective`);
	return active;
}

export function cancelGoal(sessionId: string, goalId?: string): boolean {
	const goals = loadGoals(sessionId);
	let targetId: string | undefined = goalId;
	if (!targetId) {
		const active = goals.find((g) => g.status === "active");
		if (!active) return false;
		targetId = active.id;
	}
	const idx = goals.findIndex((g) => g.id === targetId);
	if (idx === -1) return false;
	goals.splice(idx, 1);
	const nextPaused = goals.find((g) => g.status === "paused");
	if (nextPaused && !goals.some((g) => g.status === "active")) {
		nextPaused.status = "active";
		nextPaused.pausedAt = null;
		nextPaused.startedAt = nextPaused.startedAt ?? Date.now();
	}
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Cancelled goal ${targetId}`);
	return true;
}

export function clearAllGoals(sessionId: string): void {
	const path = getGoalsFilePath(sessionId);
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch (e) {
		logForDebugging(
			`[GoalState] Failed to clear goals: ${(e as Error).message}`,
		);
	}
	logForDebugging(`[GoalState] Cleared all goals for session ${sessionId}`);
}

export function reorderQueue(
	sessionId: string,
	orderedIds: string[],
): Goal[] | null {
	const goals = loadGoals(sessionId);
	const idSet = new Set(orderedIds);
	if (goals.some((g) => !idSet.has(g.id))) return null;
	const goalMap = new Map(goals.map((g) => [g.id, g]));
	const reordered = orderedIds.map((id) => goalMap.get(id)!);
	saveGoals(sessionId, reordered);
	logForDebugging(`[GoalState] Reordered goal queue`);
	return reordered;
}

export function removeFromQueue(sessionId: string, goalId: string): boolean {
	const goals = loadGoals(sessionId);
	const idx = goals.findIndex((g) => g.id === goalId);
	if (idx === -1) return false;
	if (goals[idx].status === "active") return false;
	goals.splice(idx, 1);
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Removed goal ${goalId} from queue`);
	return true;
}

export function updateBudgetUsed(
	sessionId: string,
	delta: { turns?: number; tokens?: number; wallMs?: number },
): Goal | null {
	const goals = loadGoals(sessionId);
	const active = goals.find((g) => g.status === "active");
	if (!active) return null;
	if (delta.turns) active.budgetUsed.turns += delta.turns;
	if (delta.tokens) active.budgetUsed.tokens += delta.tokens;
	if (delta.wallMs) active.budgetUsed.wallMs += delta.wallMs;
	saveGoals(sessionId, goals);
	return active;
}

export function setGoalBudget(
	sessionId: string,
	goalId: string,
	budget: GoalBudget,
): Goal | null {
	const goals = loadGoals(sessionId);
	const goal = goals.find((g) => g.id === goalId);
	if (!goal) return null;
	goal.budget = { ...goal.budget, ...budget };
	saveGoals(sessionId, goals);
	logForDebugging(`[GoalState] Set budget for goal ${goalId}`);
	return goal;
}

export function isBudgetExceeded(goal: Goal): boolean {
	const { budget, budgetUsed } = goal;
	if (budget.turns != null && budgetUsed.turns >= budget.turns) return true;
	if (budget.tokens != null && budgetUsed.tokens >= budget.tokens) return true;
	if (budget.wallMs != null && budgetUsed.wallMs >= budget.wallMs) return true;
	return false;
}

export function formatBudgetUsage(goal: Goal): string {
	const parts: string[] = [];
	if (goal.budget.turns != null) {
		parts.push(`turns: ${goal.budgetUsed.turns}/${goal.budget.turns}`);
	}
	if (goal.budget.tokens != null) {
		parts.push(`tokens: ${goal.budgetUsed.tokens}/${goal.budget.tokens}`);
	}
	if (goal.budget.wallMs != null) {
		const usedSec = Math.round(goal.budgetUsed.wallMs / 1000);
		const limitSec = Math.round(goal.budget.wallMs / 1000);
		parts.push(`time: ${usedSec}s/${limitSec}s`);
	}
	return parts.length > 0 ? parts.join(", ") : "no budget set";
}
