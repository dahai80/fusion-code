// MCP 工具自动后台化 (item 4): 慢 MCP 调用超过 FUSION_MCP_AUTO_BACKGROUND_MS
// 转后台 task, REPL 不阻塞。spawn/kill/notify 由 client.ts call() 触发。
import {
	OUTPUT_FILE_TAG,
	STATUS_TAG,
	SUMMARY_TAG,
	TASK_ID_TAG,
	TASK_NOTIFICATION_TAG,
	TOOL_USE_ID_TAG,
} from "../../constants/xml.js";
import { logError } from "../../utils/log.js";
import { enqueuePendingNotification } from "../../utils/messageQueueManager.js";
import {
	appendTaskOutput,
	evictTaskOutput,
	getTaskOutputPath,
} from "../../utils/task/diskOutput.js";
import { registerTask, updateTaskState } from "../../utils/task/framework.js";
import { escapeXml } from "../../utils/xml.js";
import {
	createTaskStateBase,
	generateTaskId,
	type SetAppState,
	type Task,
	type TaskStateBase,
} from "../../Task.js";

export type MonitorMcpTaskState = TaskStateBase & {
	type: "monitor_mcp";
	serverName: string;
	toolName: string;
	abortController?: AbortController;
	isBackgrounded?: boolean;
};

// 生成后台 MCP task 并注册到 AppState。返回 taskId + abortController,
// 调用方在背景调用上挂 controller.signal, turn-abort 时可 kill。
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

// 后台 MCP 调用完成时通知模型 (复用 LocalShellTask task-notification 模式)。
// 原子 notified 防重复, 写输出文件, 入队通知, 标 completed, evict。
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
