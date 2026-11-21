// audit 1.1.1: message display state derivation extracted from REPL.tsx. Pure functions, no React, no side effects.
// The 3 derives are chained: usesSyncMessages → displayedMessages → placeholderText.
// REPL keeps useDeferredValue(messages) and the ref declarations; only the pure computation moves out.
// All deps arrive via parameters; output is byte-equivalent to the original inline block.

import type { InProcessTeammateTaskState } from "../tasks/InProcessTeammateTask/types.js";
import type { LocalAgentTaskState } from "../tasks/LocalAgentTask/LocalAgentTask.js";
import type { Message } from "../types/message.js";

// viewedAgentTask union (PR #172 selector output) — both states carry optional messages.
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

// usesSyncMessages: when streaming text is visible or not loading, bypass useDeferredValue
// so Messages renders the final messages in the same frame (removes the flicker between spinner disappearance and answer appearance).
export function deriveUsesSyncMessages(
	showStreamingText: boolean,
	isLoading: boolean,
): boolean {
	return showStreamingText || !isLoading;
}

// displayedMessages: when viewing an agent, use the task's own messages (empty until bootstrap fills them);
// otherwise switch between synchronous messages and deferredMessages per usesSyncMessages.
// Returns the original array reference (no copy) to preserve downstream ref-identity (Messages memo / length checks).
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

// placeholderText: shows the typed text as a placeholder after submission until the real message appears.
// userInputOnProcessing persists for the whole turn (cleared by resetLoadingState); the length check hides
// the placeholder once displayedMessages exceeds the baseline captured at submission. Suppressed while
// viewing an agent (different array; onAgentSubmit does not use the placeholder).
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

// One-shot aggregation: takes the raw display state as input, outputs all 3 derives.
// REPL calls it once and binds to same-named consts; downstream reads are unchanged (byte-equivalent).
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
