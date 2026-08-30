// audit 1.1.1 slice #58: cancelRequestProps prop-bundle 外移 (PURE-ROUTING-SUB-BLOCK, like #30)。
// REPL() 构建 CancelRequestHandler props bundle: 15 字段纯路由 (state/derived 透传, 无计算分支, 无 gtuc, 无 JSX)。
// bundle 消费 2 处: <CancelRequestHandler {...cancelRequestProps} /> (REPL L4316 + L4530), 字段对应 CancelRequestHandlerProps (src/hooks/useCancelRequest.ts)。
// onAgentsKilled inline thunk () => setMessages((prev) => [...prev, createAgentsKilledMessage()]) 经 ctx 传入 setMessages + createAgentsKilledMessage
// (REPL-local, 非 import); isMessageSelectorVisible || !!showBashesDialog 为 derived, helper 内计算透传;
// abortSignal: abortController?.signal 为 derived, helper 内计算透传; isLocalJSXCommand: toolJSX?.isLocalJSXCommand 为 derived, helper 内计算透传。
// onCancel (REPL-local plain fn L2243, fn-ref 透传非调用) + setToolUseConfirmQueue + screen + vimMode +
// isSearchingHistory + isHelpOpen + inputMode + inputValue + streamMode + popCommandFromQueue (handleQueuedCommandOnCancel) 经 ctx 传入。
// 类型复用 CancelRequestHandlerProps (避免重复定义, 单一真相源); helper 返该对象, REPL plain const 赋值透传 (非 memo, 非 hook, 纯 helper)。
// 无 JSX → .ts。无 deps (plain const, 非 hook)。

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

// REPL 保留 plain const 薄壳:
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
