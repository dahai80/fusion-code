import { describe, expect, it, mock } from "bun:test";
import type { ToolUseConfirm } from "../../components/permissions/PermissionRequest.js";
import type { AppState } from "../../state/AppStateStore.js";
import type { ToolPermissionContext } from "../../Tool.js";
import {
	applyToolPermissionContext,
	type SetToolPermissionContextSetters,
} from "../../utils/toolPermissionContextSetter.js";

// audit 1.1.1: applyToolPermissionContext 单元测试。行为等价 REPL.tsx 内联
// setToolPermissionContext useCallback 体。两个动作:
//   (1) setAppState((prev) => ({...prev, toolPermissionContext: {...context, mode}}))
//       — mode 仅在非 preserveMode 时跟随新 context, 否则保留 prev.mode。
//   (2) setImmediate((setToolUseConfirmQueue) => { setToolUseConfirmQueue(q => {q.forEach(recheck); return q}) }, setToolUseConfirmQueue)
//       — setImmediate 第二参作为回调首参传入; 回调用 updater 读最新队列, 对每项 recheckPermission() 后原样返回。

function ctx(mode: ToolPermissionContext["mode"]): ToolPermissionContext {
	return {
		mode,
		additionalWorkingDirectories: new Map(),
		alwaysAllowRules: {},
		alwaysDenyRules: {},
		alwaysAskRules: {},
		isBypassPermissionsModeAvailable: false,
	};
}

function makePrev(mode: ToolPermissionContext["mode"]): AppState {
	return { toolPermissionContext: ctx(mode) } as unknown as AppState;
}

function makeSetters(initialQueue: ToolUseConfirm[] = []): {
	setters: SetToolPermissionContextSetters;
	setAppState: ReturnType<typeof mock>;
	setToolUseConfirmQueue: ReturnType<typeof mock>;
	appStateCalls: AppState[];
	queueCalls: ToolUseConfirm[][];
	queue: ToolUseConfirm[];
} {
	const appStateCalls: AppState[] = [];
	const setAppState = mock((updater: (prev: AppState) => AppState) => {
		appStateCalls.push(updater(makePrev("default")));
	});
	const queue: ToolUseConfirm[] = [...initialQueue];
	const queueCalls: ToolUseConfirm[][] = [];
	const setToolUseConfirmQueue = mock(
		(updater: (q: ToolUseConfirm[]) => ToolUseConfirm[]) => {
			const next = updater(queue);
			queueCalls.push([...next]);
			return next;
		},
	);
	return {
		setters: {
			setAppState: setAppState as never,
			setToolUseConfirmQueue: setToolUseConfirmQueue as never,
		},
		setAppState,
		setToolUseConfirmQueue,
		appStateCalls,
		queueCalls,
		queue,
	};
}

function makeQueueItem(): {
	item: ToolUseConfirm;
	recheck: ReturnType<typeof mock>;
} {
	const recheck = mock(() => Promise.resolve());
	const item = { recheckPermission: recheck } as unknown as ToolUseConfirm;
	return { item, recheck };
}

describe("applyToolPermissionContext", () => {
	it("writes merged context with new mode when preserveMode absent", () => {
		const { setters, appStateCalls } = makeSetters();
		const newCtx = ctx("plan");
		applyToolPermissionContext(newCtx, undefined, setters);
		expect(appStateCalls).toHaveLength(1);
		const written = appStateCalls[0];
		expect(written.toolPermissionContext.mode).toBe("plan");
		expect(written.toolPermissionContext.alwaysAllowRules).toBe(
			newCtx.alwaysAllowRules,
		);
	});

	it("preserves prev mode when preserveMode true (worker acceptEdits must not leak)", () => {
		const { setters, appStateCalls } = makeSetters();
		const workerCtx = ctx("acceptEdits");
		applyToolPermissionContext(workerCtx, { preserveMode: true }, setters);
		expect(appStateCalls).toHaveLength(1);
		const written = appStateCalls[0];
		// prev.mode was "default" → preserved (worker's acceptEdits NOT applied)
		expect(written.toolPermissionContext.mode).toBe("default");
		expect(written.toolPermissionContext.alwaysAllowRules).toBe(
			workerCtx.alwaysAllowRules,
		);
	});

	it("uses new context mode when preserveMode false (explicit user mode change)", () => {
		const { setters, appStateCalls } = makeSetters();
		const newCtx = ctx("acceptEdits");
		applyToolPermissionContext(newCtx, { preserveMode: false }, setters);
		expect(appStateCalls[0].toolPermissionContext.mode).toBe("acceptEdits");
	});

	it("setImmediate passes setToolUseConfirmQueue as callback arg + rechecks every queued item", (done) => {
		const { item: item1, recheck: recheck1 } = makeQueueItem();
		const { item: item2, recheck: recheck2 } = makeQueueItem();
		const { setters, queueCalls } = makeSetters([item1, item2]);
		applyToolPermissionContext(baseContext(), undefined, setters);
		setImmediate(() => {
			expect(queueCalls).toHaveLength(1);
			expect(recheck1).toHaveBeenCalledTimes(1);
			expect(recheck2).toHaveBeenCalledTimes(1);
			done();
		});
	});

	it("rechecks zero queued items without error", (done) => {
		const { setters, queueCalls } = makeSetters();
		applyToolPermissionContext(baseContext(), undefined, setters);
		setImmediate(() => {
			expect(queueCalls).toHaveLength(1);
			expect(queueCalls[0]).toHaveLength(0);
			done();
		});
	});

	it("queue updater returns the same queue reference (no re-creation)", (done) => {
		const { item } = makeQueueItem();
		const returnedRef: ToolUseConfirm[][] = [];
		const queue: ToolUseConfirm[] = [item];
		const setToolUseConfirmQueue = mock(
			(updater: (q: ToolUseConfirm[]) => ToolUseConfirm[]) => {
				returnedRef.push(updater(queue));
				return returnedRef[returnedRef.length - 1];
			},
		);
		const setters = {
			setAppState: mock(() => {}) as never,
			setToolUseConfirmQueue: setToolUseConfirmQueue as never,
		} as SetToolPermissionContextSetters;
		applyToolPermissionContext(baseContext(), undefined, setters);
		setImmediate(() => {
			// updater returns currentQueue unchanged → same array identity
			expect(returnedRef[0]).toBe(queue);
			done();
		});
	});
});

function baseContext(): ToolPermissionContext {
	return ctx("default");
}
