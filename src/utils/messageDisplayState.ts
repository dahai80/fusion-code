// audit 1.1.1: 从 REPL.tsx 抽出的消息显示状态推导。纯函数, 无 React, 无副作用。
// 3 个 derive 链式相依: usesSyncMessages → displayedMessages → placeholderText。
// REPL 保留 useDeferredValue(messages) 与 ref 声明, 仅把纯计算外移。
// deps 全部经入参传入, 输出与原内联块字节等价。

import type { Message } from "../types/message.js";
import type {
	InProcessTeammateTaskState,
} from "../tasks/InProcessTeammateTask/types.js";
import type { LocalAgentTaskState } from "../tasks/LocalAgentTask/LocalAgentTask.js";

// viewedAgentTask 联合 (PR #172 selector 输出) — 两态都有可选 messages。
export type ViewedAgentTaskLike =
	| InProcessTeammateTaskState
	| LocalAgentTaskState
	| undefined;

export type MessageDisplayInput = {
	showStreamingText: boolean;
	isLoading: boolean;
	viewedAgentTask: ViewedAgentTaskLike;
	messages: Message[];
	deferredMessages: Message[];
	userInputOnProcessing: string | undefined;
	userInputBaseline: number;
};

export type MessageDisplayState = {
	usesSyncMessages: boolean;
	displayedMessages: Message[];
	placeholderText: string | undefined;
};

// usesSyncMessages: 流式文本可见或非 loading 时绕过 useDeferredValue,
// 让 Messages 同帧渲染最终消息 (消除 spinner 消失与答案出现之间的抖动)。
export function deriveUsesSyncMessages(
	showStreamingText: boolean,
	isLoading: boolean,
): boolean {
	return showStreamingText || !isLoading;
}

// displayedMessages: 查看 agent 时用 task 自有消息 (空直到 bootstrap 填充);
// 否则按 usesSyncMessages 在同步 messages 与 deferredMessages 间切换。
// 返回原数组引用 (不拷贝), 保持下游 ref-identity (Messages memo / length 检查)。
export function deriveDisplayedMessages(
	viewedAgentTask: ViewedAgentTaskLike,
	usesSyncMessages: boolean,
	messages: Message[],
	deferredMessages: Message[],
): Message[] {
	return viewedAgentTask
		? (viewedAgentTask.messages ?? [])
		: usesSyncMessages
			? messages
			: deferredMessages;
}

// placeholderText: 用户提交后真实消息出现前显示输入文本占位。
// userInputOnProcessing 整 turn 保持 (resetLoadingState 清除); 长度判断在
// displayedMessages 超过提交时基线后隐藏占位。查看 agent 时抑制 (不同数组,
// onAgentSubmit 不用占位)。
export function derivePlaceholderText(
	userInputOnProcessing: string | undefined,
	viewedAgentTask: ViewedAgentTaskLike,
	displayedMessagesLength: number,
	userInputBaseline: number,
): string | undefined {
	return userInputOnProcessing &&
		!viewedAgentTask &&
		displayedMessagesLength <= userInputBaseline
		? userInputOnProcessing
		: undefined;
}

// 一次性聚合: 输入原始显示状态, 输出全部 3 个 derive。
// REPL 调用一次, 绑定到同名 const, 下游读取不变 (字节等价)。
export function deriveMessageDisplayState(
	input: MessageDisplayInput,
): MessageDisplayState {
	const usesSyncMessages = deriveUsesSyncMessages(
		input.showStreamingText,
		input.isLoading,
	);
	const displayedMessages = deriveDisplayedMessages(
		input.viewedAgentTask,
		usesSyncMessages,
		input.messages,
		input.deferredMessages,
	);
	const placeholderText = derivePlaceholderText(
		input.userInputOnProcessing,
		input.viewedAgentTask,
		displayedMessages.length,
		input.userInputBaseline,
	);
	return { usesSyncMessages, displayedMessages, placeholderText };
}
