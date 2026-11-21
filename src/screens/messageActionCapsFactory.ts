// audit 1.1.1 slice #52: messageActionCaps object literal extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#51).
// REPL() messageActionCaps object literal: copy (OSC-52 clipboard write + "copied" toast) + edit (rewind lossless→direct restore / otherwise confirm dialog).
// Original const object literal. findRawIndex (24-char prefix match) is the only sibling .edit depends on, moved into the helper as a private fn too (using ctx.messages).
// addNotification + messages + fileHistory + onCancel + handleRestoreMessage + setMessageSelectorPreselect + setIsMessageSelectorVisible (deps triggers) passed via ctx (closure capture), byte-equivalent behavior.
// Not a hook (plain object); REPL calls the factory in a plain const assignment (no useCallback/useMemo thin shell, the object was already not memoized — hook stores caps via ref, reads latest closure at dispatch).
// 3 module imports imported directly (not REPL state, per imported-helpers-directly rule; setClipboard single use in REPL, REPL import removed after extraction; fileHistoryHasAnyChanges/multi-use + selectableUserMessagesFilter/multi-use + messagesAfterAreOnlySynthetic/multi-use keep the REPL import, helper imports directly too).
// No JSX → .ts. Returns MessageActionCaps (REPL passes it through to useMessageActions).

import type { Dispatch, SetStateAction } from "react";
import {
	messagesAfterAreOnlySynthetic,
	selectableUserMessagesFilter,
} from "../components/MessageSelector.js";
import type { MessageActionCaps } from "../components/messageActions.js";
import type { Notification } from "../context/notifications.js";
import { setClipboard } from "../ink/termio/osc.js";
import type { Message as MessageType, UserMessage } from "../types/message.js";
import type { FileHistoryState } from "../utils/fileHistory.js";
import { fileHistoryHasAnyChanges } from "../utils/fileHistory.js";

type MessageActionCapsFactoryCtx = {
	addNotification: (content: Notification) => void;
	messages: MessageType[];
	fileHistory: FileHistoryState;
	onCancel: () => void;
	handleRestoreMessage: (message: UserMessage) => Promise<void>;
	setMessageSelectorPreselect: (value: UserMessage | undefined) => void;
	setIsMessageSelectorVisible: Dispatch<SetStateAction<boolean>>;
};

// 24-char prefix: deriveUUID preserves first 24, renderable uuid prefix-matches raw source.
function findRawIndex(messages: MessageType[], uuid: string): number {
	const prefix = uuid.slice(0, 24);
	return messages.findIndex((m) => m.uuid.slice(0, 24) === prefix);
}

// REPL calls directly (no memoization — hook stores caps via ref, reads latest closure at dispatch):
//   const messageActionCaps: MessageActionCaps = createMessageActionCaps({ addNotification, messages, fileHistory, onCancel, handleRestoreMessage, setMessageSelectorPreselect, setIsMessageSelectorVisible });
export function createMessageActionCaps(
	ctx: MessageActionCapsFactoryCtx,
): MessageActionCaps {
	return {
		copy: (text) =>
			// setClipboard RETURNS OSC 52 — caller must stdout.write (tmux side-effects load-buffer, but that's tmux-only).
			void setClipboard(text).then((raw) => {
				if (raw) process.stdout.write(raw);
				ctx.addNotification({
					// Same key as text-selection copy — repeated copies replace toast, don't queue.
					key: "selection-copied",
					text: "copied",
					color: "success",
					priority: "immediate",
					timeoutMs: 2000,
				});
			}),
		edit: async (msg) => {
			// Same skip-confirm check as /rewind: lossless → direct, else confirm dialog.
			const rawIdx = findRawIndex(ctx.messages, msg.uuid);
			const raw = rawIdx >= 0 ? ctx.messages[rawIdx] : undefined;
			if (!raw || !selectableUserMessagesFilter(raw)) return;
			const noFileChanges = !(await fileHistoryHasAnyChanges(
				ctx.fileHistory,
				raw.uuid,
			));
			const onlySynthetic = messagesAfterAreOnlySynthetic(ctx.messages, rawIdx);
			if (noFileChanges && onlySynthetic) {
				// rewindConversationTo's setMessages races stream appends — cancel first (idempotent).
				ctx.onCancel();
				// handleRestoreMessage also restores pasted images.
				void ctx.handleRestoreMessage(raw);
			} else {
				// Dialog path: onPreRestore (= onCancel) fires when user CONFIRMS, not on nevermind.
				ctx.setMessageSelectorPreselect(raw);
				ctx.setIsMessageSelectorVisible(true);
			}
		},
	};
}
