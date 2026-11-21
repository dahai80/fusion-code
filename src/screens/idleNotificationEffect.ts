// audit 1.1.1 slice #54: idle-notification useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#53).
// REPL() mount-ish useEffect: response finished + user idle → after a timed check, send the idle_prompt notification (maybeSendIdleNotification, inner callback already moved out in slice #30).
// Original useEffect body: 3 guards (isLoading/submitCount===0/lastQueryCompletionTime===0) → setTimeout(getGlobalConfig().messageIdleNotifThresholdMs, 5 stale-closure-bypass args) → return () => clearTimeout(timer).
// isLoading + submitCount + lastQueryCompletionTime + toolJSX + focusedInputDialogRef + terminal (deps triggers) passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out; helper returns a cleanup fn or undefined (undefined when guards early-return, matching the original useEffect return semantics).
// maybeSendIdleNotification (utils/idleNotification, slice #30 inner) + getGlobalConfig (utils/config) imported directly (not REPL state, per imported-helpers-directly rule; maybeSendIdleNotification single use in REPL, REPL import removed after extraction; getGlobalConfig used multiple times in REPL, REPL import kept, helper imports it directly too).
// ctx 5-field type derived from the maybeSendIdleNotification parameters (its ToolJSX/IdleNotificationCtx are not exported, use Parameters<typeof> to avoid duplicate definitions), + submitCount (guard only).
// No JSX → .ts. Returns (() => void) | undefined (REPL thin-shell useEffect pass-through).
// deps [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal] unchanged (focusedInputDialogRef is a stable ref, safe to omit, matching the original).

import { getGlobalConfig } from "../utils/config.js";
import type { maybeSendIdleNotification } from "../utils/idleNotification.js";
import { maybeSendIdleNotification as maybeSendIdleNotificationFn } from "../utils/idleNotification.js";

type IdleNotificationCtx = Parameters<typeof maybeSendIdleNotification>[0];

type IdleNotificationEffectCtx = {
	submitCount: number;
} & IdleNotificationCtx;

// REPL keeps the useEffect thin shell:
//   useEffect(() => maybeScheduleIdleNotification({ isLoading, submitCount, lastQueryCompletionTime, toolJSX, focusedInputDialogRef, terminal }), [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal]);
export function maybeScheduleIdleNotification(
	ctx: IdleNotificationEffectCtx,
): (() => void) | undefined {
	// Don't set up notification if Claude is busy
	if (ctx.isLoading) return;

	// Only enable notifications after the first new interaction in this session
	if (ctx.submitCount === 0) return;

	// No query has completed yet
	if (ctx.lastQueryCompletionTime === 0) return;

	// Set timeout to check idle state
	const timer = setTimeout(
		(
			lastQueryCompletionTime,
			isLoading,
			toolJSX,
			focusedInputDialogRef,
			terminal,
		) => {
			// audit 1.1.1: idle-notification callback body → maybeSendIdleNotification (PURE-ROUTING SUB-BLOCK).
			// 5 setTimeout-arg parameters passed as ctx (bypasses stale closure), byte-equivalent behavior.
			maybeSendIdleNotificationFn({
				lastQueryCompletionTime,
				isLoading,
				toolJSX,
				focusedInputDialogRef,
				terminal,
			});
		},
		getGlobalConfig().messageIdleNotifThresholdMs,
		ctx.lastQueryCompletionTime,
		ctx.isLoading,
		ctx.toolJSX,
		ctx.focusedInputDialogRef,
		ctx.terminal,
	);
	return () => clearTimeout(timer);
}
