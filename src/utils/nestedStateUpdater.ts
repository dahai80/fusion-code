// audit 1.1.1: two isomorphic nested-state update wrappers extracted from getToolUseContext in REPL.tsx.
// updateFileHistoryState + updateAttributionState were each 14 LOC with identical structure:
//   setAppState((prev) => { const updated = updater(prev[key]); if (updated === prev[key]) return prev; return {...prev, [key]: updated} })
// Same-ref skip = perf optimization (fileHistoryTrackEdit returns state unchanged for already-tracked files, avoiding setState,
// so every no-op does not notify all store listeners). The two methods differ only in key + slice type →
// one generic helper (literal-key union) covers both; the REPL thin wrapper passes "fileHistory"|"attribution".
// No React hooks, no JSX, no await. Only side effect = calling setAppState.

import type { AppState } from "../state/AppStateStore.js";

// Only these two keys: both are top-level slices with their own types, and the updater skips on same-ref.
export type NestedStateKey = "fileHistory" | "attribution";

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void;

// Behavior equivalent to the REPL.tsx:2794-2820 updateFileHistoryState / updateAttributionState method bodies.
// REPL keeps the thin wrappers: updateFileHistoryState: (u) => applyNestedStateUpdater(setAppState, "fileHistory", u)
// Literal key → TS infers K, updater type = (prev: AppState[K]) => AppState[K], matching the ToolUseContext signature.
export function applyNestedStateUpdater<K extends NestedStateKey>(
	setAppState: SetAppStateFn,
	key: K,
	updater: (prev: AppState[K]) => AppState[K],
): void {
	setAppState((prev) => {
		const updated = updater(prev[key]);
		if (updated === prev[key]) return prev;
		return {
			...prev,
			[key]: updated,
		};
	});
}
