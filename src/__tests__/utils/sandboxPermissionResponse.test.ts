import { describe, expect, it, mock } from "bun:test";
import type { AppState } from "../../state/AppStateStore.js";

// audit 1.1.1: handleLocalSandboxUserResponse 单元测试。行为等价 REPL.tsx
// SandboxPermissionRequest.onUserResponse (local 分支, REPL.tsx:5675-5734)。
// 3 副作用: (1) persistToSettings → setAppState toolPermissionContext + persistPermissionUpdate + SandboxManager.refreshConfig;
//   (2) setSandboxPermissionRequestQueue 解析同-host pending + 过滤; (3) bridge cleanup ref 清理。
// mock 3 个 import (applyPermissionUpdate/persistPermissionUpdate/SandboxManager.refreshConfig) 隔离外部副作用
// (real persistPermissionUpdate 写盘, SandboxManager.refreshConfig 读 config 文件)。
// 同 manifest.test.ts 模式: 顶层 await mock.module + await import 测试模块。

const applyPermissionUpdateMock = mock((_ctx: unknown, _update: unknown) => ({
	rules: [],
}));
const persistPermissionUpdateMock = mock((_update: unknown) => {});
const refreshConfigMock = mock(() => {});
const sendResponseViaMailboxMock = mock(
	async (
		_workerName: string,
		_requestId: string,
		_host: string,
		_allow: boolean,
		_teamName?: string,
	) => true,
);

await mock.module("../../utils/permissions/PermissionUpdate.js", () => ({
	applyPermissionUpdate: applyPermissionUpdateMock,
	persistPermissionUpdate: persistPermissionUpdateMock,
}));
await mock.module("../../tools/WebFetchTool/prompt.js", () => ({
	WEB_FETCH_TOOL_NAME: "WebFetch",
}));
await mock.module("../../utils/sandbox/sandbox-adapter.js", () => ({
	SandboxManager: { refreshConfig: refreshConfigMock },
}));
await mock.module("../../utils/swarm/permissionSync.js", () => ({
	sendSandboxPermissionResponseViaMailbox: sendResponseViaMailboxMock,
}));

const { handleLocalSandboxUserResponse, handleWorkerSandboxUserResponse } =
	await import("../../utils/sandboxPermissionResponse.js");

type Item = {
	hostPattern: { host: string; port: number };
	resolvePromise: (allowConnection: boolean) => void;
};

function makeCtx(queue: Item[]) {
	const setAppState = mock((updater: (prev: AppState) => AppState) =>
		updater({} as AppState),
	);
	const setSandboxPermissionRequestQueue = mock(
		(updater: (queue: Item[]) => Item[]) => {
			const next = updater(queue);
			queue.length = 0;
			queue.push(...next);
		},
	);
	const cleanupFns = [mock(() => {}), mock(() => {})];
	const sandboxBridgeCleanupRef = {
		current: new Map<string, Array<() => void>>([["a.com", cleanupFns]]),
	};
	return {
		setAppState,
		setSandboxPermissionRequestQueue,
		sandboxBridgeCleanupRef,
		cleanupFns,
	};
}

function resetMocks() {
	applyPermissionUpdateMock.mockReset();
	persistPermissionUpdateMock.mockReset();
	refreshConfigMock.mockReset();
	sendResponseViaMailboxMock.mockReset();
}

describe("handleLocalSandboxUserResponse", () => {
	it("persistToSettings=true allow=true → setAppState + persist + refreshConfig called once", () => {
		resetMocks();
		const queue: Item[] = [
			{
				hostPattern: { host: "a.com", port: 443 },
				resolvePromise: mock(() => {}),
			},
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: true, persistToSettings: true },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(ctx.setAppState).toHaveBeenCalledTimes(1);
		expect(persistPermissionUpdateMock).toHaveBeenCalledTimes(1);
		expect(refreshConfigMock).toHaveBeenCalledTimes(1);
		// update passed to persist: behavior "allow" (allow=true)
		expect(persistPermissionUpdateMock.mock.calls[0][0]).toMatchObject({
			behavior: "allow",
			destination: "localSettings",
		});
	});

	it("persistToSettings=true allow=false → behavior 'deny'", () => {
		resetMocks();
		const queue: Item[] = [
			{
				hostPattern: { host: "a.com", port: 443 },
				resolvePromise: mock(() => {}),
			},
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: false, persistToSettings: true },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(persistPermissionUpdateMock.mock.calls[0][0]).toMatchObject({
			behavior: "deny",
		});
	});

	it("persistToSettings=false → NO persist/refreshConfig (only queue resolve)", () => {
		resetMocks();
		const queue: Item[] = [
			{
				hostPattern: { host: "a.com", port: 443 },
				resolvePromise: mock(() => {}),
			},
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: true, persistToSettings: false },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		// persistToSettings false → persist/refresh NOT called
		expect(persistPermissionUpdateMock).not.toHaveBeenCalled();
		expect(refreshConfigMock).not.toHaveBeenCalled();
		// but setSandboxPermissionRequestQueue still resolves queue
		expect(ctx.setSandboxPermissionRequestQueue).toHaveBeenCalledTimes(1);
	});

	it("empty queue → early return, no side effects", () => {
		resetMocks();
		const queue: Item[] = [];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: true, persistToSettings: true },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(ctx.setSandboxPermissionRequestQueue).not.toHaveBeenCalled();
		expect(ctx.setAppState).not.toHaveBeenCalled();
		expect(persistPermissionUpdateMock).not.toHaveBeenCalled();
	});

	it("resolves ALL same-host pending requests + filters them out of queue", () => {
		resetMocks();
		const r1 = mock(() => {});
		const r2 = mock(() => {});
		const r3 = mock(() => {});
		const queue: Item[] = [
			{ hostPattern: { host: "a.com", port: 443 }, resolvePromise: r1 },
			{ hostPattern: { host: "a.com", port: 443 }, resolvePromise: r2 },
			{ hostPattern: { host: "b.com", port: 443 }, resolvePromise: r3 },
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: true, persistToSettings: false },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(r1).toHaveBeenCalledWith(true);
		expect(r2).toHaveBeenCalledWith(true);
		expect(r3).not.toHaveBeenCalled();
		// b.com item survives in queue (a.com filtered out)
		expect(queue).toHaveLength(1);
		expect(queue[0].hostPattern.host).toBe("b.com");
	});

	it("deny=false → resolves same-host pending with false", () => {
		resetMocks();
		const r1 = mock(() => {});
		const queue: Item[] = [
			{ hostPattern: { host: "a.com", port: 443 }, resolvePromise: r1 },
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: false, persistToSettings: false },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(r1).toHaveBeenCalledWith(false);
	});

	it("runs all bridge cleanup fns for the host + deletes ref key", () => {
		resetMocks();
		const queue: Item[] = [
			{
				hostPattern: { host: "a.com", port: 443 },
				resolvePromise: mock(() => {}),
			},
		];
		const ctx = makeCtx(queue);
		handleLocalSandboxUserResponse(
			{ allow: false, persistToSettings: false },
			{
				sandboxPermissionRequestQueue: queue,
				setSandboxPermissionRequestQueue: ctx.setSandboxPermissionRequestQueue,
				setAppState: ctx.setAppState,
				sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
			},
		);
		expect(ctx.cleanupFns[0]).toHaveBeenCalledTimes(1);
		expect(ctx.cleanupFns[1]).toHaveBeenCalledTimes(1);
		expect(ctx.sandboxBridgeCleanupRef.current.has("a.com")).toBe(false);
	});

	it("no bridge cleanups registered → no-ops the cleanup block (no throw)", () => {
		resetMocks();
		const queue: Item[] = [
			{
				hostPattern: { host: "fresh.com", port: 443 },
				resolvePromise: mock(() => {}),
			},
		];
		const ctx = makeCtx(queue);
		// fresh.com not in cleanupRef map
		expect(() =>
			handleLocalSandboxUserResponse(
				{ allow: true, persistToSettings: false },
				{
					sandboxPermissionRequestQueue: queue,
					setSandboxPermissionRequestQueue:
						ctx.setSandboxPermissionRequestQueue,
					setAppState: ctx.setAppState,
					sandboxBridgeCleanupRef: ctx.sandboxBridgeCleanupRef,
				},
			),
		).not.toThrow();
	});
});

type WorkerItem = {
	requestId: string;
	workerId: string;
	workerName: string;
	workerColor?: string;
	host: string;
	createdAt: number;
};

function makeWorkerCtx(queue: WorkerItem[]) {
	const setAppState = mock((updater: (prev: AppState) => AppState) => {
		updater({
			workerSandboxPermissions: { queue, selectedIndex: 0 },
		} as AppState);
	});
	return { setAppState };
}

describe("handleWorkerSandboxUserResponse", () => {
	it("allow=true persistToSettings=true → mailbox send + persist + refreshConfig + queue slice", () => {
		resetMocks();
		const queue: WorkerItem[] = [
			{
				requestId: "r1",
				workerId: "w1",
				workerName: "alpha",
				host: "a.com",
				createdAt: 0,
			},
		];
		const ctx = makeWorkerCtx(queue);
		handleWorkerSandboxUserResponse(
			{ allow: true, persistToSettings: true },
			{
				workerSandboxPermissions: { queue },
				setAppState: ctx.setAppState,
				teamName: "team-x",
			},
		);
		// mailbox: (workerName, requestId, host, allow, teamName)
		expect(sendResponseViaMailboxMock).toHaveBeenCalledWith(
			"alpha",
			"r1",
			"a.com",
			true,
			"team-x",
		);
		expect(persistPermissionUpdateMock).toHaveBeenCalledTimes(1);
		expect(refreshConfigMock).toHaveBeenCalledTimes(1);
		// setAppState called twice: once for permission, once for queue slice
		expect(ctx.setAppState).toHaveBeenCalledTimes(2);
	});

	it("allow=false persistToSettings=true → mailbox send + NO persist (only-allow persists) + queue slice", () => {
		resetMocks();
		const queue: WorkerItem[] = [
			{
				requestId: "r1",
				workerId: "w1",
				workerName: "alpha",
				host: "a.com",
				createdAt: 0,
			},
		];
		const ctx = makeWorkerCtx(queue);
		handleWorkerSandboxUserResponse(
			{ allow: false, persistToSettings: true },
			{
				workerSandboxPermissions: { queue },
				setAppState: ctx.setAppState,
				teamName: "team-x",
			},
		);
		expect(sendResponseViaMailboxMock).toHaveBeenCalledWith(
			"alpha",
			"r1",
			"a.com",
			false,
			"team-x",
		);
		// deny → NO persist/refresh (worker persists only on allow)
		expect(persistPermissionUpdateMock).not.toHaveBeenCalled();
		expect(refreshConfigMock).not.toHaveBeenCalled();
		// but queue still sliced (setAppState called once for slice)
		expect(ctx.setAppState).toHaveBeenCalledTimes(1);
	});

	it("persistToSettings=false → mailbox send + NO persist + queue slice", () => {
		resetMocks();
		const queue: WorkerItem[] = [
			{
				requestId: "r1",
				workerId: "w1",
				workerName: "alpha",
				host: "a.com",
				createdAt: 0,
			},
		];
		const ctx = makeWorkerCtx(queue);
		handleWorkerSandboxUserResponse(
			{ allow: true, persistToSettings: false },
			{
				workerSandboxPermissions: { queue },
				setAppState: ctx.setAppState,
			},
		);
		expect(sendResponseViaMailboxMock).toHaveBeenCalledWith(
			"alpha",
			"r1",
			"a.com",
			true,
			undefined,
		);
		expect(persistPermissionUpdateMock).not.toHaveBeenCalled();
		expect(ctx.setAppState).toHaveBeenCalledTimes(1);
	});

	it("empty queue → early return, no side effects", () => {
		resetMocks();
		const queue: WorkerItem[] = [];
		const ctx = makeWorkerCtx(queue);
		handleWorkerSandboxUserResponse(
			{ allow: true, persistToSettings: true },
			{
				workerSandboxPermissions: { queue },
				setAppState: ctx.setAppState,
			},
		);
		expect(sendResponseViaMailboxMock).not.toHaveBeenCalled();
		expect(persistPermissionUpdateMock).not.toHaveBeenCalled();
		expect(ctx.setAppState).not.toHaveBeenCalled();
	});
});
