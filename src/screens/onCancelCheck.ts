// audit 1.1.1 slice #59: onCancel plain-fn body extracted (INLINE-CALLBACK curried-factory, like #20/#22).
// REPL() Escape cancel handling: dialog routing (elicitation returns directly / tool-permission abort / prompt reject / remote interrupt / local abort) +
// proactive pause + queryGuard.forceEnd + streaming-text preservation + resetLoadingState + setAbortController(null) + mrOnTurnComplete(aborted=true).
// Original `function onCancel()` (L2244-2306, 63 LOC, not a hook, not memoized — the closure is rebuilt each render reading latest state, the messageActionCaps comment at L3737 explicitly relies on this semantics).
// The helper returns a `() => void` closure; REPL calls `createOnCancel(ctx)` each render to get a fresh closure (byte-equivalent to the original function-decl rebuild semantics, not a thunk, not useCallback).
// onCancel is passed through by ref, consumed in 3 places: cancelRequestProps (slice #58 ctx) L2325 / createMessageActionCaps L3743 / <MessageSelector onPreRestore> L5119; no pre-decl direct call (hoisting not relied on, const is safe).
// 18 ctx fields (closure capture): focusedInputDialog/streamMode/proactiveModule/queryGuard/skipIdleCheckRef/streamingText/setMessages/
// resetLoadingState/snapshotOutputTokensForTurn/toolUseConfirmQueue/setToolUseConfirmQueue/promptQueue/setPromptQueue/
// abortController/setAbortController/mrOnTurnComplete/messagesRef.
// Imports direct (not via ctx, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept): logForDebugging (utils/debug) +
// feature (bun:bundle, build-time macro, proven usable in sandboxAskCheck) + createAssistantMessage (utils/messages) +
// FocusedDialogKind/SpinnerMode/ToolUseConfirm/PromptRequest/PromptResponse/QueryGuard/MessageType (types).
// No JSX → .ts. No deps (plain fn rebuilt, not a hook).

import { feature } from "bun:bundle";
import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";
import type { SpinnerMode } from "../components/Spinner/types.js";
import type { PromptRequest, PromptResponse } from "../types/hooks.js";
import type { Message as MessageType } from "../types/message.js";
import { logForDebugging } from "../utils/debug.js";
import type { FocusedDialogKind } from "../utils/focusedDialogSelector.js";
import { createAssistantMessage } from "../utils/messages.js";
import type { QueryGuard } from "../utils/QueryGuard.js";

type PromptQueueItem = {
	request: PromptRequest;
	title: string;
	toolInputSummary?: string | null;
	resolve: (response: PromptResponse) => void;
	reject: (error: Error) => void;
};

type ProactiveModuleLike = {
	pauseProactive: () => void;
} | null;

export type OnCancelCtx = {
	focusedInputDialog: FocusedDialogKind | undefined;
	streamMode: SpinnerMode;
	proactiveModule: ProactiveModuleLike | undefined;
	queryGuard: QueryGuard;
	skipIdleCheckRef: React.MutableRefObject<boolean>;
	streamingText: string | null;
	setMessages: (action: React.SetStateAction<MessageType[]>) => void;
	resetLoadingState: () => void;
	snapshotOutputTokensForTurn: (budget: number | null) => void;
	toolUseConfirmQueue: ToolUseConfirm[];
	setToolUseConfirmQueue: (queue: ToolUseConfirm[]) => void;
	promptQueue: PromptQueueItem[];
	setPromptQueue: (queue: PromptQueueItem[]) => void;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	mrOnTurnComplete: (all: MessageType[], aborted: boolean) => Promise<void>;
	messagesRef: React.MutableRefObject<MessageType[]>;
};

// REPL keeps the plain fn thin shell (called each render for a fresh closure, equivalent to the original function-decl rebuild semantics):
//   const onCancel = createOnCancel({
//     focusedInputDialog, streamMode, proactiveModule, queryGuard, skipIdleCheckRef,
//     streamingText, setMessages, resetLoadingState, snapshotOutputTokensForTurn,
//     toolUseConfirmQueue, setToolUseConfirmQueue, promptQueue, setPromptQueue,
//     abortController, setAbortController, mrOnTurnComplete, messagesRef,
//   });
export function createOnCancel(ctx: OnCancelCtx): () => void {
	return () => {
		if (ctx.focusedInputDialog === "elicitation") {
			// Elicitation dialog handles its own Escape, and closing it shouldn't affect any loading state.
			return;
		}
		logForDebugging(
			`[onCancel] focusedInputDialog=${ctx.focusedInputDialog} streamMode=${ctx.streamMode}`,
		);

		// Pause proactive mode so the user gets control back.
		// It will resume when they submit their next input (see onSubmit).
		if (feature("PROACTIVE") || feature("KAIROS")) {
			ctx.proactiveModule?.pauseProactive();
		}
		ctx.queryGuard.forceEnd();
		ctx.skipIdleCheckRef.current = false;

		// Preserve partially-streamed text so the user can read what was
		// generated before pressing Esc. Pushed before resetLoadingState clears
		// streamingText, and before query.ts yields the async interrupt marker,
		// giving final order [user, partial-assistant, [Request interrupted by user]].
		if (ctx.streamingText?.trim()) {
			ctx.setMessages((prev) => [
				...prev,
				createAssistantMessage({
					content: ctx.streamingText,
				}),
			]);
		}
		ctx.resetLoadingState();

		// Clear any active token budget so the backstop doesn't fire on
		// a stale budget if the query generator hasn't exited yet.
		if (feature("TOKEN_BUDGET")) {
			ctx.snapshotOutputTokensForTurn(null);
		}
		if (ctx.focusedInputDialog === "tool-permission") {
			// Tool use confirm handles the abort signal itself
			ctx.toolUseConfirmQueue[0]?.onAbort();
			ctx.setToolUseConfirmQueue([]);
		} else if (ctx.focusedInputDialog === "prompt") {
			// Reject all pending prompts and clear the queue
			for (const item of ctx.promptQueue) {
				item.reject(new Error("Prompt cancelled by user"));
			}
			ctx.setPromptQueue([]);
			ctx.abortController?.abort("user-cancel");
		}

		// Clear the controller so subsequent Escape presses don't see a stale
		// aborted signal. Without this, canCancelRunningTask is false (signal
		// defined but .aborted === true), so isActive becomes false if no other
		// activating conditions hold — leaving the Escape keybinding inactive.
		ctx.setAbortController(null);

		// forceEnd() skips the finally path — fire directly (aborted=true).
		void ctx.mrOnTurnComplete(ctx.messagesRef.current, true);
	};
}
