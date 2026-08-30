// audit 1.1.1 slice #59: onCancel plain-fn body 外移 (INLINE-CALLBACK curried-factory, like #20/#22)。
// REPL() Escape 取消处理: dialog 分流 (elicitation 直返 / tool-permission abort / prompt reject / remote 中断 / 本地 abort) +
// proactive pause + queryGuard.forceEnd + 流式文本保留 + resetLoadingState + setAbortController(null) + mrOnTurnComplete(aborted=true)。
// 原 `function onCancel()` (L2244-2306, 63-LOC, 非 hook 非 memo — 每 render 重建闭包读最新 state, messageActionCaps 注释 L3737 显式依赖此语义)。
// 辅助返闭包 `() => void`, REPL 每 render 调 `createOnCancel(ctx)` 取新闭包 (与原 function decl 重建语义字节等价, 非 thunk 非 useCallback)。
// onCancel 经 ref 透传 3 处消费: cancelRequestProps (slice #58 ctx) L2325 / createMessageActionCaps L3743 / <MessageSelector onPreRestore> L5119; 无 pre-decl 直调 (hoist 不依赖, const 安全)。
// 18 ctx 字段 (闭包捕获): focusedInputDialog/streamMode/proactiveModule/queryGuard/skipIdleCheckRef/streamingText/setMessages/
// resetLoadingState/snapshotOutputTokensForTurn/toolUseConfirmQueue/setToolUseConfirmQueue/promptQueue/setPromptQueue/
// abortController/setAbortController/activeRemote/mrOnTurnComplete/messagesRef。
// 导入直接 (非 ctx, per imported-helpers-directly rule; REPL 多用, 保留 REPL import): logForDebugging (utils/debug) +
// feature (bun:bundle, build-time macro, sandboxAskCheck 已证可用) + createAssistantMessage (utils/messages) +
// FocusedDialogKind/SpinnerMode/ToolUseConfirm/PromptRequest/PromptResponse/QueryGuard/MessageType (类型)。
// 无 JSX → .ts。无 deps (plain fn 重建, 非 hook)。

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

type ActiveRemoteLike = {
	isRemoteMode: boolean;
	cancelRequest: () => void;
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
	activeRemote: ActiveRemoteLike;
	mrOnTurnComplete: (all: MessageType[], aborted: boolean) => Promise<void>;
	messagesRef: React.MutableRefObject<MessageType[]>;
};

// REPL 保留 plain fn 薄壳 (每 render 调用取新闭包, 与原 function decl 重建语义等价):
//   const onCancel = createOnCancel({
//     focusedInputDialog, streamMode, proactiveModule, queryGuard, skipIdleCheckRef,
//     streamingText, setMessages, resetLoadingState, snapshotOutputTokensForTurn,
//     toolUseConfirmQueue, setToolUseConfirmQueue, promptQueue, setPromptQueue,
//     abortController, setAbortController, activeRemote, mrOnTurnComplete, messagesRef,
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
		} else if (ctx.activeRemote.isRemoteMode) {
			// Remote mode: send interrupt signal to CCR
			ctx.activeRemote.cancelRequest();
		} else {
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
