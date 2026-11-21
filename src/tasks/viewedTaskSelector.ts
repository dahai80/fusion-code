// audit 1.1.1: viewedTask selector extracted from REPL.tsx. Pure function, no React, no side effects.
// The three-stage derivation only reads its inputs and outputs a narrowed task union. REPL's original inline
// block drove downstream boolean decisions.

import type { InProcessTeammateTaskState } from "./InProcessTeammateTask/types.js";
import { isInProcessTeammateTask } from "./InProcessTeammateTask/types.js";
import type { LocalAgentTaskState } from "./LocalAgentTask/LocalAgentTask.js";
import { isLocalAgentTask } from "./LocalAgentTask/LocalAgentTask.js";
import type { TaskState } from "./types.js";

// viewedTask: raw record lookup by id, undefined if id missing/absent.
export function getViewedTask(
	tasks: Readonly<Record<string, TaskState>>,
	viewingAgentTaskId: string | undefined,
): TaskState | undefined {
	return viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
}

// viewedTeammateTask: teammate-only narrowed, for teammate-specific field access
// (inProgressToolUseIDs)。
export function getViewedTeammateTask(
	viewedTask: TaskState | undefined,
): InProcessTeammateTaskState | undefined {
	if (viewedTask && isInProcessTeammateTask(viewedTask)) return viewedTask;
	return undefined;
}

// viewedAgentTask: teammate OR local_agent — drives boolean checks downstream。
export function getViewedAgentTask(
	viewedTask: TaskState | undefined,
	viewedTeammateTask: InProcessTeammateTaskState | undefined,
): InProcessTeammateTaskState | LocalAgentTaskState | undefined {
	return (
		viewedTeammateTask ??
		(viewedTask && isLocalAgentTask(viewedTask) ? viewedTask : undefined)
	);
}
