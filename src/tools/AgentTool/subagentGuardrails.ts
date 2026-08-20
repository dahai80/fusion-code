import type { AppState } from "../../state/AppStateStore.js";
import { isLocalAgentTask } from "../../tasks/LocalAgentTask/LocalAgentTask.js";
import { logForDebugging } from "../../utils/debug.js";
import { getRunningTasks } from "../../utils/task/framework.js";

// P2.1 subagent guardrails (CC 2.1.217 对齐). Spawn-time caps enforced in
// AgentTool.call() before sync/async dispatch. Returns an error message when a
// cap is exceeded, or null when spawn is allowed. Env defaults match CC A.2.1.
//
// Dimensions covered: concurrency / session count / spawn depth.
// Budget cap (per-agent cost) + background-default spawn are out of scope here
// — separate items.

export const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 20;
export const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200;
export const DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH = 3;

// Parse a positive-integer env cap. Falls back to `defaultValue` when unset,
// empty, non-numeric, or <= 0 (guard against a misconfigured 0/negative cap
// that would block ALL spawns — fail open, not silent).
function parseCap(envValue: string | undefined, defaultValue: number): number {
	if (envValue === undefined || envValue === "") return defaultValue;
	const parsed = Number.parseInt(envValue, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		logForDebugging(
			`[subagentGuardrails] invalid cap env "${envValue}", falling back to ${defaultValue}`,
		);
		return defaultValue;
	}
	return parsed;
}

export function getMaxConcurrentSubagents(): number {
	return parseCap(
		process.env.FUSION_MAX_CONCURRENT_SUBAGENTS,
		DEFAULT_MAX_CONCURRENT_SUBAGENTS,
	);
}

export function getMaxSubagentsPerSession(): number {
	return parseCap(
		process.env.FUSION_MAX_SUBAGENTS_PER_SESSION,
		DEFAULT_MAX_SUBAGENTS_PER_SESSION,
	);
}

export function getMaxSubagentSpawnDepth(): number {
	return parseCap(
		process.env.FUSION_MAX_SUBAGENT_SPAWN_DEPTH,
		DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH,
	);
}

// Count live (running) local_agent subagents currently in AppState. Excludes
// shell/teammate/main-session tasks so the cap reflects real concurrent agent
// load, not unrelated background work.
export function countRunningSubagents(state: AppState): number {
	return getRunningTasks(state).filter(isLocalAgentTask).length;
}

export type SubagentGuardrailInput = {
	appState: AppState;
	depth: number;
	// Session-cumulative spawn count (AppState.subagentSpawnCount), tracked +
	// reset-on-/clear by AgentTool + clearConversation.
	sessionSpawnCount: number;
};

// Returns a human-readable rejection reason, or null if all caps pass.
// Ordered: depth → concurrency → session — depth is cheapest (no state scan)
// and most likely to trip in runaway recursion, so check it first.
export function checkSubagentGuardrails(
	input: SubagentGuardrailInput,
): string | null {
	const { appState, depth, sessionSpawnCount } = input;

	const maxDepth = getMaxSubagentSpawnDepth();
	if (depth >= maxDepth) {
		return `Subagent spawn depth ${depth} reached the limit of ${maxDepth} (FUSION_MAX_SUBAGENT_SPAWN_DEPTH). Nested subagent spawning is blocked beyond this depth — complete the task directly with your own tools.`;
	}

	const maxConcurrent = getMaxConcurrentSubagents();
	const running = countRunningSubagents(appState);
	if (running >= maxConcurrent) {
		return `Subagent spawn rejected: ${running} subagent(s) already running, at the concurrency limit of ${maxConcurrent} (FUSION_MAX_CONCURRENT_SUBAGENTS). Wait for a running subagent to finish, or raise the limit.`;
	}

	const maxPerSession = getMaxSubagentsPerSession();
	if (sessionSpawnCount >= maxPerSession) {
		return `Subagent spawn rejected: ${sessionSpawnCount} subagent(s) spawned this session, at the session limit of ${maxPerSession} (FUSION_MAX_SUBAGENTS_PER_SESSION). Start a new session with /clear to reset the count, or raise the limit.`;
	}

	return null;
}
