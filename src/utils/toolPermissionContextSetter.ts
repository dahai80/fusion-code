// audit 1.1.1: pure routing wrapper for setToolPermissionContext extracted from REPL.tsx.
// No React hooks, no JSX, no await. The only side effects = calling setAppState (store setter)
//   + setImmediate triggering setToolUseConfirmQueue (same as the original useCallback body).
// Semantics: update toolPermissionContext (mode follows the new context only when not preserveMode);
//   after the context changes, immediately recheck all queued permission items (avoids a stale closure
//   reading the latest queue via callback).
// Original useCallback deps = [setAppState, setToolUseConfirmQueue] (2 stable setters);
//   REPL keeps a thin wrapper, downstream reads the same-named const (byte-equivalent).

import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";
import type { AppState } from "../state/AppStateStore.js";
import type { ToolPermissionContext } from "../Tool.js";

// setToolPermissionContext input options. preserveMode = keep the coordinator's existing mode
// (a worker getAppState() returning 'acceptEdits' must not leak into the coordinator's real state).
export type SetToolPermissionContextOptions =
	| {
			preserveMode?: boolean;
	  }
	| undefined;

// setAppState = zustand store.setState; the updater receives prev → full AppState (REPL expanded form).
export type SetAppStateFn = (updater: (prev: AppState) => AppState) => void;

// setToolUseConfirmQueue = useState setter; callback form reads the latest queue and returns it as-is (no reshuffle).
export type SetToolUseConfirmQueueFn = (
	updater: (queue: ToolUseConfirm[]) => ToolUseConfirm[],
) => void;

// The 2 stable setters bound to a REPL instance.
export type SetToolPermissionContextSetters = {
	setAppState: SetAppStateFn;
	setToolUseConfirmQueue: SetToolUseConfirmQueueFn;
};

// Apply a tool-permission-context update: merge context into appState
// (mode preserved when preserveMode set), then setImmediate-recheck every
// queued permission item so "don't ask again" approvals auto-clear matches.
// Behavior-equivalent to the REPL.tsx:2738-2776 useCallback body. REPL keeps a thin useCallback
// wrapper (deps [setAppState, setToolUseConfirmQueue] unchanged).
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
