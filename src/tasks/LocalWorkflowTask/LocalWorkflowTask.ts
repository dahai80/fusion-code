// audit 1.4.2 (CRITICAL): workflow kill was previously a no-op STUB (console.log only).
// stopTask / killAllActive / reaper call taskImpl.kill → this kill → abortWorkflowRun
// triggers the existing abort check in runtime.ts (throws "Workflow aborted" at lines 328/390)
// and pushes the task to the killed terminal state. runId is stored in task state (written at
// WorkflowTool registration) and used to look up the controller in abortRegistry.

import type { SetAppState, Task, TaskStateBase } from "../../Task.js";
import { abortWorkflowRun } from "../../tools/WorkflowTool/abortRegistry.js";
import { logForDebugging } from "../../utils/debug.js";
import { updateTaskState } from "../../utils/task/framework.js";
import type { TaskState } from "../types.js";

export type LocalWorkflowTaskState = TaskStateBase & {
	type: "local_workflow";
	agents: string[];
	currentAgentIndex: number;
	abortController?: AbortController;
	runId?: string; // audit 1.4.2: key for looking up abortRegistry
	summary?: string; // log: fix TS2339
};

// audit 1.4.2: real kill. Triggers abort + pushes terminal state. Idempotent: terminal states untouched.
export function killWorkflowTask(
	taskId: string,
	setAppState: SetAppState,
): void {
	let aborted = false;
	let runId: string | undefined;
	updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, (task) => {
		if (task.status !== "running") {
			return task;
		}
		runId = task.runId;
		// Abort the controller first (may live in state, or only in the registry).
		task.abortController?.abort();
		aborted = true;
		return {
			...task,
			status: "killed",
			endTime: Date.now(),
			abortController: undefined,
		};
	});
	// The registry controller (registered by WorkflowTool) must also be aborted — the
	// abortController in task state is the same reference as the registry's, but the
	// registry is the authoritative source for the kill path (state may lose the
	// controller through serialization/restore). Look it up via runId as a double safeguard.
	if (runId) {
		abortWorkflowRun(runId);
	}
	if (aborted) {
		logForDebugging(
			`[LocalWorkflowTask] killed workflow task ${taskId} (runId=${runId})`,
		);
	}
}

// audit 1.4.4 (HIGH): ESC / kill-agents now also kills background workflows. Symmetric with
// killAllRunningAgentTasks: iterate AppState.tasks and kill all running local_workflow tasks.
// WorkflowTool wrote runId into the task at registration; killWorkflowTask uses it to look up
// abortRegistry and trigger the abort.
export function killAllRunningWorkflowTasks(
	tasks: Record<string, TaskState>,
	setAppState: SetAppState,
): void {
	for (const [taskId, task] of Object.entries(tasks)) {
		if (task.type === "local_workflow" && task.status === "running") {
			killWorkflowTask(taskId, setAppState);
		}
	}
}

export function skipWorkflowAgent(
	taskId: string,
	agentId: string,
	_setAppState: SetAppState,
): void {
	console.log("[LocalWorkflowTask] skipWorkflowAgent called", taskId, agentId);
}

export function retryWorkflowAgent(
	taskId: string,
	agentId: string,
	_setAppState: SetAppState,
): void {
	console.log("[LocalWorkflowTask] retryWorkflowAgent called", taskId, agentId);
}

export const LocalWorkflowTask: Task = {
	name: "LocalWorkflowTask",
	type: "local_workflow",

	async kill(taskId, setAppState) {
		killWorkflowTask(taskId, setAppState);
	},
};
