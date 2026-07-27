// log: created for TS2307 fix

import type { SetAppState, Task, TaskStateBase } from "../../Task.js";

export type MonitorMcpTaskState = TaskStateBase & {
	type: "monitor_mcp";
	serverName: string;
	abortController?: AbortController;
};

export function killMonitorMcpTasksForAgent(
	agentId: string,
	getAppState: () => unknown,
	setAppState: SetAppState,
): void {
	console.log("[MonitorMcpTask] killMonitorMcpTasksForAgent called", agentId);
}

export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
	console.log("[MonitorMcpTask] killMonitorMcp called", taskId);
}

export const MonitorMcpTask: Task = {
	name: "MonitorMcpTask",
	type: "monitor_mcp",

	async kill(taskId, setAppState) {
		killMonitorMcp(taskId, setAppState);
	},
};
