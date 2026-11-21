// MCP tool auto-backgrounding (item 4): slow MCP calls exceeding FUSION_MCP_AUTO_BACKGROUND_MS
// move to a background task so the REPL does not block. spawn/kill/notify are triggered by client.ts call().
import {
	OUTPUT_FILE_TAG,
	STATUS_TAG,
	SUMMARY_TAG,
	TASK_ID_TAG,
	TASK_NOTIFICATION_TAG,
	TOOL_USE_ID_TAG,
} from "../../constants/xml.js";
import {
	createTaskStateBase,
	generateTaskId,
	type SetAppState,
	type Task,
	type TaskStateBase,
} from "../../Task.js";
import { logError } from "../../utils/log.js";
import { enqueuePendingNotification } from "../../utils/messageQueueManager.js";
import {
	appendTaskOutput,
	evictTaskOutput,
	getTaskOutputPath,
} from "../../utils/task/diskOutput.js";
import { registerTask, updateTaskState } from "../../utils/task/framework.js";
import { escapeXml } from "../../utils/xml.js";

export type MonitorMcpTaskState = TaskStateBase & {
	type: "monitor_mcp";
	serverName: string;
	toolName: string;
	abortController?: AbortController;
	isBackgrounded?: boolean;
};

// Spawn a background MCP task and register it in AppState. Returns taskId + abortController;
// the caller attaches controller.signal to the background call so it can be killed on turn-abort.
export function spawnMonitorMcpTask(
	serverName: string,
	toolName: string,
	toolUseId: string | undefined,
	setAppState: SetAppState,
): { taskId: string; abortController: AbortController } {
	const taskId = generateTaskId("monitor_mcp");
	const abortController = new AbortController();
	const state: MonitorMcpTaskState = {
		...createTaskStateBase(
			taskId,
			"monitor_mcp",
			`MCP ${serverName}/${toolName}`,
			toolUseId,
		),
		type: "monitor_mcp",
		status: "running",
		serverName,
		toolName,
		abortController,
		isBackgrounded: true,
	};
	registerTask(state, setAppState);
	return { taskId, abortController };
}

// Notify the model when a background MCP call completes (reuses the LocalShellTask task-notification pattern).
// Atomic notified flag prevents duplicates; writes the output file, enqueues the notification, marks completed, evicts.
export function notifyMonitorMcpTaskDone(
	taskId: string,
	serverName: string,
	toolName: string,
	status: "completed" | "failed",
	contentStr: string,
	setAppState: SetAppState,
	toolUseId?: string,
): void {
	const outputPath = getTaskOutputPath(taskId);
	const summary =
		status === "completed"
			? `MCP tool "${serverName}/${toolName}" completed (backgrounded)`
			: `MCP tool "${serverName}/${toolName}" failed (backgrounded)`;
	try {
		appendTaskOutput(taskId, contentStr);
	} catch (error) {
		logError(error);
	}

	let shouldEnqueue = false;
	updateTaskState<MonitorMcpTaskState>(taskId, setAppState, (task) => {
		if (task.notified) {
			return task;
		}
		shouldEnqueue = true;
		return { ...task, notified: true, status, endTime: Date.now() };
	});
	if (!shouldEnqueue) {
		void evictTaskOutput(taskId);
		return;
	}
	const toolUseIdLine = toolUseId
		? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
		: "";
	const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
	enqueuePendingNotification({
		value: message,
		mode: "task-notification",
		priority: "later",
	});
	void evictTaskOutput(taskId);
}

export function killMonitorMcpTasksForAgent(
	agentId: string,
	_getAppState: () => unknown,
	_setAppState: SetAppState,
): void {
	console.log("[MonitorMcpTask] killMonitorMcpTasksForAgent called", agentId);
}

export function killMonitorMcp(taskId: string, setAppState: SetAppState): void {
	updateTaskState<MonitorMcpTaskState>(taskId, setAppState, (task) => {
		task.abortController?.abort();
		return { ...task, status: "killed", endTime: Date.now(), notified: true };
	});
	void evictTaskOutput(taskId);
}

export const MonitorMcpTask: Task = {
	name: "MonitorMcpTask",
	type: "monitor_mcp",

	async kill(taskId, setAppState) {
		killMonitorMcp(taskId, setAppState);
	},
};
