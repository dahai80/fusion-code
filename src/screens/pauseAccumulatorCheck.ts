// audit 1.1.1 slice #48: pause/resume timing accumulation useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#45/#47).
// REPL() treats a switch of focusedInputDialog to "tool-permission" during loading as pause: record pauseStartTime immediately;
// switching back to non-paused with pauseStartTime set → accumulate totalPausedMs, clear pauseStartTime.
// Purpose: no reliance on 100ms polling; captured on focusedInputDialog change, timing stays accurate under high load.
// Original useEffect body. focusedInputDialog + isLoading (derived deps) + pauseStartTimeRef + totalPausedMsRef (refs) passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// No module imports (pure refs + derived, simplest slice). No JSX → .ts. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [focusedInputDialog, isLoading] unchanged (both refs are stable, safe to omit, matching the original).

import type { MutableRefObject } from "react";
import type { FocusedDialogKind } from "../utils/focusedDialogSelector.js";

type PauseAccumulatorCheckCtx = {
	focusedInputDialog: FocusedDialogKind | undefined;
	isLoading: boolean;
	pauseStartTimeRef: MutableRefObject<number | null>;
	totalPausedMsRef: MutableRefObject<number>;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => maybeAccumulatePauseTiming({ focusedInputDialog, isLoading, pauseStartTimeRef, totalPausedMsRef }), [focusedInputDialog, isLoading]);
export function maybeAccumulatePauseTiming(
	ctx: PauseAccumulatorCheckCtx,
): void {
	if (!ctx.isLoading) return;
	const isPaused = ctx.focusedInputDialog === "tool-permission";
	const now = Date.now();
	if (isPaused && ctx.pauseStartTimeRef.current === null) {
		// Just entered pause state - record the exact moment
		ctx.pauseStartTimeRef.current = now;
	} else if (!isPaused && ctx.pauseStartTimeRef.current !== null) {
		// Just exited pause state - accumulate paused time immediately
		ctx.totalPausedMsRef.current += now - ctx.pauseStartTimeRef.current;
		ctx.pauseStartTimeRef.current = null;
	}
}
