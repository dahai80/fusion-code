// audit 1.4.2 (CRITICAL): workflow kill 之前是 no-op STUB (只 console.log)。
// stopTask / killAllActive / reaper 调 taskImpl.kill → 本 kill → abortWorkflowRun
// 触发 runtime.ts 已有的 abort 检查 (328/390 行抛 "Workflow aborted"), 并把 task
// 推到 killed 终态。runId 存在 task state 里 (WorkflowTool 注册时写入), 用它反查
// abortRegistry 里的 controller。

import type { SetAppState, Task, TaskStateBase } from "../../Task.js";
import type { TaskState } from "../types.js";
import { logForDebugging } from "../../utils/debug.js";
import { updateTaskState } from "../../utils/task/framework.js";
import { abortWorkflowRun } from "../../tools/WorkflowTool/abortRegistry.js";

export type LocalWorkflowTaskState = TaskStateBase & {
	type: "local_workflow";
	agents: string[];
	currentAgentIndex: number;
	abortController?: AbortController;
	runId?: string; // audit 1.4.2: 反查 abortRegistry 的 key
	summary?: string; // log: fix TS2339
};

// audit 1.4.2: 真实 kill。触发 abort + 推终态。幂等: 已终态不动。
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
		// 先 abort controller (可能存于 state, 也可能仅存于 registry)。
		task.abortController?.abort();
		aborted = true;
		return {
			...task,
			status: "killed",
			endTime: Date.now(),
			abortController: undefined,
		};
	});
	// registry 里的 controller (WorkflowTool 注册的) 也要 abort —— task state 里的
	// abortController 与 registry 里是同一引用, 但 registry 是 kill 路径的权威来源
	// (state 可能因序列化/恢复丢 controller)。用 runId 反查, 双保险。
	if (runId) {
		abortWorkflowRun(runId);
	}
	if (aborted) {
		logForDebugging(`[LocalWorkflowTask] killed workflow task ${taskId} (runId=${runId})`);
	}
}

// audit 1.4.4 (HIGH): ESC / kill-agents 现在也杀后台 workflow。与
// killAllRunningAgentTasks 对称: 遍历 AppState.tasks, 杀所有 running 的
// local_workflow。WorkflowTool 注册 task 时写了 runId, killWorkflowTask
// 据此反查 abortRegistry 触发 abort。
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
