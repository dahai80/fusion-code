import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AppState } from "../../state/AppState.js";
import type { SetAppState } from "../../Task.js";
import {
	MonitorMcpTask,
	killMonitorMcp,
	notifyMonitorMcpTaskDone,
	spawnMonitorMcpTask,
} from "../../tasks/MonitorMcpTask/MonitorMcpTask.js";

// 造一个最小 AppState — tasks map + 接 setAppState updater
type FakeTaskState = {
	type: string;
	status: string;
	serverName?: string;
	toolName?: string;
	toolUseId?: string;
	isBackgrounded?: boolean;
	notified?: boolean;
	endTime?: number;
};

function makeAppStateStore(): {
	get: () => { tasks: Record<string, FakeTaskState> };
	set: SetAppState;
} {
	let state = { tasks: {} } as unknown as AppState;
	const setAppState: SetAppState = (updater) => {
		state = updater(state);
	};
	const getAppState = () => state as unknown as {
		tasks: Record<string, FakeTaskState>;
	};
	return { get: getAppState, set: setAppState };
}

describe("MonitorMcpTask (item 4 MCP 自动后台)", () => {
	beforeEach(() => {
		process.env = { ...process.env };
	});
	afterEach(() => {
		mock.restore();
	});

	it("spawnMonitorMcpTask 注册 running task 带 server/tool 名", () => {
		const store = makeAppStateStore();
		const { taskId, abortController } = spawnMonitorMcpTask(
			"slack",
			"search",
			"toolu_123",
			store.set,
		);
		expect(taskId).toMatch(/^m[0-9a-z]+$/);
		const task = store.get().tasks[taskId];
		expect(task.type).toBe("monitor_mcp");
		expect(task.status).toBe("running");
		expect(task.serverName).toBe("slack");
		expect(task.toolName).toBe("search");
		expect(task.toolUseId).toBe("toolu_123");
		expect(task.isBackgrounded).toBe(true);
		expect(abortController).toBeInstanceOf(AbortController);
	});

	it("notifyMonitorMcpTaskDone completed: 标 status + notified + 入队通知", () => {
		const store = makeAppStateStore();
		const { taskId } = spawnMonitorMcpTask(
			"github",
			"create_issue",
			"toolu_456",
			store.set,
		);
		let enqCount = 0;
		mock.module("../../utils/messageQueueManager.js", () => ({
			enqueuePendingNotification: mock(() => {
				enqCount++;
			}),
		}));
		notifyMonitorMcpTaskDone(
			taskId,
			"github",
			"create_issue",
			"completed",
			"issue #42 created",
			store.set,
			"toolu_456",
		);
		const task = store.get().tasks[taskId];
		expect(task.status).toBe("completed");
		expect(task.notified).toBe(true);
		expect(task.endTime).toBeGreaterThan(0);
		expect(enqCount).toBe(1);
	});

	it("notifyMonitorMcpTaskDone 幂等: 二次调用不重复入队", () => {
		const store = makeAppStateStore();
		const { taskId } = spawnMonitorMcpTask(
			"db",
			"query",
			undefined,
			store.set,
		);
		let enqCount = 0;
		mock.module("../../utils/messageQueueManager.js", () => ({
			enqueuePendingNotification: mock(() => {
				enqCount++;
			}),
		}));
		notifyMonitorMcpTaskDone(
			taskId,
			"db",
			"query",
			"completed",
			"rows",
			store.set,
		);
		notifyMonitorMcpTaskDone(
			taskId,
			"db",
			"query",
			"completed",
			"rows",
			store.set,
		);
		expect(enqCount).toBe(1);
	});

	it("killMonitorMcp: abort controller + 标 killed + notified", () => {
		const store = makeAppStateStore();
		const { taskId, abortController } = spawnMonitorMcpTask(
			"fs",
			"read",
			"toolu_789",
			store.set,
		);
		const aborted = mock(() => {});
		abortController.signal.addEventListener("abort", aborted);
		killMonitorMcp(taskId, store.set);
		expect(aborted).toHaveBeenCalledTimes(1);
		const task = store.get().tasks[taskId];
		expect(task.status).toBe("killed");
		expect(task.notified).toBe(true);
	});

	it("MonitorMcpTask Task obj: type=monitor_mcp, kill 委派", async () => {
		expect(MonitorMcpTask.type).toBe("monitor_mcp");
		expect(MonitorMcpTask.name).toBe("MonitorMcpTask");
		const store = makeAppStateStore();
		const { taskId } = spawnMonitorMcpTask("s", "t", undefined, store.set);
		await MonitorMcpTask.kill(taskId, store.set);
		expect(store.get().tasks[taskId].status).toBe("killed");
	});
});
