// audit 1.1.1: 从 REPL.tsx 抽出的 setToolPermissionContext 包装纯路由。
// 无 React hooks, 无 JSX, 无 await。唯一副作用 = 调用 setAppState (store setter)
//   + setImmediate 触发 setToolUseConfirmQueue (与原 useCallback 体一致)。
// 语义: 更新 toolPermissionContext (mode 仅在非 preserveMode 时跟随新 context);
//   context 变更后立即 recheck 所有排队权限项 (避免 stale closure 用回调读最新队列)。
// 原 useCallback deps = [setAppState, setToolUseConfirmQueue] (2 个稳定 setter);
//   REPL 保留薄包装, 下游读取同名 const (字节等价)。

import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";
import type { AppState } from "../state/AppStateStore.js";
import type { ToolPermissionContext } from "../Tool.js";

// setToolPermissionContext 入参选项。preserveMode = 保留协调者既有 mode
// (worker getAppState() 回传 'acceptEdits' 不可泄漏到协调者真实 state)。
export type SetToolPermissionContextOptions =
	| {
			preserveMode?: boolean;
	  }
	| undefined;

// setAppState = zustand store.setState, updater 接收 prev → 完整 AppState (REPL 展开写法)。
export type SetAppStateFn = (updater: (prev: AppState) => AppState) => void;

// setToolUseConfirmQueue = useState setter, 回调形式读最新队列再原样返回 (不重组)。
export type SetToolUseConfirmQueueFn = (
	updater: (queue: ToolUseConfirm[]) => ToolUseConfirm[],
) => void;

// REPL 实例绑定的 2 个稳定 setter。
export type SetToolPermissionContextSetters = {
	setAppState: SetAppStateFn;
	setToolUseConfirmQueue: SetToolUseConfirmQueueFn;
};

// Apply a tool-permission-context update: merge context into appState
// (mode preserved when preserveMode set), then setImmediate-recheck every
// queued permission item so "don't ask again" approvals auto-clear matches.
// 行为等价 REPL.tsx:2738-2776 useCallback 体。REPL 保留 useCallback 薄包装
// (deps [setAppState, setToolUseConfirmQueue] 不变)。
export function applyToolPermissionContext(
	context: ToolPermissionContext,
	options: SetToolPermissionContextOptions,
	setters: SetToolPermissionContextSetters,
): void {
	setters.setAppState((prev) => ({
		...prev,
		toolPermissionContext: {
			...context,
			// Preserve the coordinator's mode only when explicitly requested.
			// Workers' getAppState() returns a transformed context with mode
			// 'acceptEdits' that must not leak into the coordinator's actual
			// state via permission-rule updates — those call sites pass
			// { preserveMode: true }. User-initiated mode changes (e.g.,
			// selecting "allow all edits") must NOT be overridden.
			mode: options?.preserveMode
				? prev.toolPermissionContext.mode
				: context.mode,
		},
	}));

	// When permission context changes, recheck all queued items
	// This handles the case where approving item1 with "don't ask again"
	// should auto-approve other queued items that now match the updated rules
	setImmediate((setToolUseConfirmQueue) => {
		// Use setToolUseConfirmQueue callback to get current queue state
		// instead of capturing it in the closure, to avoid stale closure issues
		setToolUseConfirmQueue((currentQueue) => {
			currentQueue.forEach((item) => {
				void item.recheckPermission();
			});
			return currentQueue;
		});
	}, setters.setToolUseConfirmQueue);
}
