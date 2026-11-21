// audit 1.1.1: extracted from the setTimeout callback body of the REPL.tsx idle-notification useEffect (PURE-ROUTING SUB-BLOCK class, like slice #25/#26/#27/#28).
// Behavior equivalent to REPL.tsx:4489-4512 (setTimeout callback body). No React hooks, no JSX, no await (void sendNotification fire-and-forget).
// After a response ends, if the user is idle (no interaction + idleTime >= messageIdleNotifThresholdMs + not loading/not a tool/no focused dialog) → send the idle_prompt notification.
// The callback's 5 setTimeout-arg parameters are passed in as ctx (React anti-pattern workaround: passing args to setTimeout bypasses stale closures, preserving the original semantics).
//   ctx = {lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal}.
//   getLastInteractionTime/sendNotification/getGlobalConfig are separate module imports.
import { getLastInteractionTime } from "../bootstrap/state.js";
import type { TerminalNotification } from "../ink/useTerminalNotification.js";
import { sendNotification } from "../services/notifier.js";
import { getGlobalConfig } from "./config.js";
import type { getFocusedInputDialog } from "./focusedDialogSelector.js";

type ToolJSX = {
	jsx: React.ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	isImmediate?: boolean;
} | null;

type IdleNotificationCtx = {
	lastQueryCompletionTime: number;
	isLoading: boolean;
	toolJSX: ToolJSX;
	focusedInputDialogRef: React.MutableRefObject<
		ReturnType<typeof getFocusedInputDialog> | undefined
	>;
	terminal: TerminalNotification;
};

// REPL keeps the useEffect thin shell (guards + setTimeout setup + clearTimeout cleanup), callback body changed to:
//   (_lastQueryCompletionTime, _isLoading, _toolJSX, _focusedInputDialogRef, _terminal) => maybeSendIdleNotification({lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal});
export function maybeSendIdleNotification(ctx: IdleNotificationCtx): void {
	const lastUserInteraction = getLastInteractionTime();
	if (lastUserInteraction > ctx.lastQueryCompletionTime) {
		// User interacted since Claude finished — not idle, don't notify.
		return;
	}
	const idleTimeSinceResponse = Date.now() - ctx.lastQueryCompletionTime;
	if (
		!ctx.isLoading &&
		!ctx.toolJSX &&
		// Use ref to get current dialog state, avoiding stale closure
		ctx.focusedInputDialogRef.current === undefined &&
		idleTimeSinceResponse >= getGlobalConfig().messageIdleNotifThresholdMs
	) {
		void sendNotification(
			{
				message: "The assistant is waiting for your input",
				notificationType: "idle_prompt",
			},
			ctx.terminal,
		);
	}
}
