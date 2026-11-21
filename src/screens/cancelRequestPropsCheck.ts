// audit 1.1.1 slice #58: cancelRequestProps prop-bundle extracted (PURE-ROUTING-SUB-BLOCK, like #30).
// REPL() builds the CancelRequestHandler props bundle: 15 fields of pure routing (state/derived pass-through, no computed branches, no gtuc, no JSX).
// bundle consumed in 2 places: <CancelRequestHandler {...cancelRequestProps} /> (REPL L4316 + L4530), fields match CancelRequestHandlerProps (src/hooks/useCancelRequest.ts).
// onAgentsKilled inline thunk () => setMessages((prev) => [...prev, createAgentsKilledMessage()]) — setMessages + createAgentsKilledMessage passed via ctx
// (REPL-local, not imported); isMessageSelectorVisible || !!showBashesDialog is derived, computed inside the helper and passed through;
// abortSignal: abortController?.signal is derived, computed inside the helper and passed through; isLocalJSXCommand: toolJSX?.isLocalJSXCommand is derived, computed inside the helper and passed through.
// onCancel (REPL-local plain fn L2243, fn-ref passed through, not called) + setToolUseConfirmQueue + screen + vimMode +
// isSearchingHistory + isHelpOpen + inputMode + inputValue + streamMode + popCommandFromQueue (handleQueuedCommandOnCancel) passed via ctx.
// Type reuses CancelRequestHandlerProps (avoids duplicate definitions, single source of truth); helper returns that object, REPL assigns it to a plain const (not memo, not hook, pure helper).
// No JSX → .ts. No deps (plain const, not a hook).

import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";
import type { SpinnerMode } from "../components/Spinner/types.js";
import type { Message as MessageType } from "../types/message.js";
import type { PromptInputMode, VimMode } from "../types/textInputTypes.js";
import type { Screen } from "./REPL.js";

type CreateAgentsKilledMessageFn = () => MessageType;

export type CancelRequestPropsCtx = {
	setToolUseConfirmQueue: (
		f: (toolUseConfirmQueue: ToolUseConfirm[]) => ToolUseConfirm[],
	) => void;
	onCancel: () => void;
	setMessages: (action: React.SetStateAction<MessageType[]>) => void;
	createAgentsKilledMessage: CreateAgentsKilledMessageFn;
	isMessageSelectorVisible: boolean;
	showBashesDialog: string | boolean;
	screen: Screen;
	abortController: AbortController | null | undefined;
	popCommandFromQueue?: () => void;
	vimMode?: VimMode;
	toolJSX:
		| {
				isLocalJSXCommand?: boolean;
		  }
		| null
		| undefined;
	isSearchingHistory?: boolean;
	isHelpOpen?: boolean;
	inputMode?: PromptInputMode;
	inputValue?: string;
	streamMode?: SpinnerMode;
};

// REPL keeps the plain const thin shell:
//   const cancelRequestProps = buildCancelRequestProps({
//     setToolUseConfirmQueue, onCancel, setMessages, createAgentsKilledMessage,
//     isMessageSelectorVisible, showBashesDialog, screen, abortController,
//     popCommandFromQueue: handleQueuedCommandOnCancel, vimMode,
//     toolJSX, isSearchingHistory, isHelpOpen, inputMode, inputValue, streamMode,
//   });
export function buildCancelRequestProps(ctx: CancelRequestPropsCtx): {
	setToolUseConfirmQueue: (
		f: (toolUseConfirmQueue: ToolUseConfirm[]) => ToolUseConfirm[],
	) => void;
	onCancel: () => void;
	onAgentsKilled: () => void;
	isMessageSelectorVisible: boolean;
	screen: Screen;
	abortSignal: AbortSignal | undefined;
	popCommandFromQueue?: () => void;
	vimMode?: VimMode;
	isLocalJSXCommand?: boolean;
	isSearchingHistory?: boolean;
	isHelpOpen?: boolean;
	inputMode?: PromptInputMode;
	inputValue?: string;
	streamMode?: SpinnerMode;
} {
	return {
		setToolUseConfirmQueue: ctx.setToolUseConfirmQueue,
		onCancel: ctx.onCancel,
		onAgentsKilled: () =>
			ctx.setMessages((prev) => [...prev, ctx.createAgentsKilledMessage()]),
		isMessageSelectorVisible:
			ctx.isMessageSelectorVisible || !!ctx.showBashesDialog,
		screen: ctx.screen,
		abortSignal: ctx.abortController?.signal,
		popCommandFromQueue: ctx.popCommandFromQueue,
		vimMode: ctx.vimMode,
		isLocalJSXCommand: ctx.toolJSX?.isLocalJSXCommand,
		isSearchingHistory: ctx.isSearchingHistory,
		isHelpOpen: ctx.isHelpOpen,
		inputMode: ctx.inputMode,
		inputValue: ctx.inputValue,
		streamMode: ctx.streamMode,
	};
}
