// audit 1.1.1: 从 REPL.tsx 抽出的 viewedTask 选择器。纯函数, 无 React, 无副作用。
// 三段推导只读入参, 输出 narrowed task union。REPL 的原内联块驱动下游布尔判断。

import type { TaskState } from "./types.js";
import { isInProcessTeammateTask } from "./InProcessTeammateTask/types.js";
import type { InProcessTeammateTaskState } from "./InProcessTeammateTask/types.js";
import { isLocalAgentTask } from "./LocalAgentTask/LocalAgentTask.js";
import type { LocalAgentTaskState } from "./LocalAgentTask/LocalAgentTask.js";

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
