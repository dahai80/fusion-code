// audit 1.1.1: pure conversation rewind/restore computation extracted from REPL.tsx. No React, no JSX, no side effects
// (only calls the setters passed in, identical to the original useCallback body). 2 derives:
//   rewindConversationTo — truncates messages to just before the target message, resets conversation ID +
//     microcompact state + permission mode + prompt suggestion (does not touch the input box).
//   restoreMessageSync — rewind + backfills input text/mode + restores pasted images. Used directly by auto-restore
//     (rendered in the same batch as abort's setMessages, no flicker); MessageSelector goes through handleRestoreMessage
//     wrapped in setImmediate.
// messagesRef index is computed from ref.current (always fresh via the setMessages wrapper); callers have no stale-closure concerns.
// Original code body moved out verbatim; REPL keeps the useCallback thin wrapper (deps array unchanged), downstream reads the same const (byte-equivalent).
// feature("CONTEXT_COLLAPSE") is a bun:bundle compile-time macro; string-literal arguments are DCE-safe across files.

import { feature } from "bun:bundle";
import { randomUUID } from "node:crypto";
import { logEvent } from "../services/analytics/index.js";
import { resetMicrocompactState } from "../services/compact/index.js";
import type { AppState } from "../state/AppStateStore.js";
import type { ImageBlockParam } from "../types/anthropic-protocol.js";
import type { Message as MessageType, UserMessage } from "../types/message.js";
import type { PromptInputMode } from "../types/textInputTypes.js";
import type { PastedContent } from "./config.js";
import { textForResubmit } from "./messages.js";

// REPL-instance-bound setters + messages ref. Setters come from useState/useCallback/useSetAppState,
// independent per instance. messagesRef is a useRef<MessageType[]>; only .current is read here (the ref itself is not mutated).
// setAppState = Zustand StoreApi<AppState>.setState, accepting a (prev:AppState)=>AppState updater.
export type RewindMessageSetters = {
	messagesRef: { current: MessageType[] };
	setMessages: (next: MessageType[]) => void;
	// conversationId is the template-literal UUID type inferred from useState(randomUUID()).
	// randomUUID() returns the same type, passed directly; the REPL caller wraps it in a lambda to adapt Dispatch<SetStateAction>.
	setConversationId: (id: ReturnType<typeof randomUUID>) => void;
	setAppState: (updater: (prev: AppState) => AppState) => void;
};

export type RestoreMessageSetters = RewindMessageSetters & {
	setInputValue: (v: string) => void;
	setInputMode: (v: PromptInputMode) => void;
	setPastedContents: (next: Record<number, PastedContent>) => void;
};

// Rewind conversation state to just before `message`: slice messages,
// reset conversation ID, microcompact state, permission mode, prompt suggestion.
// Does NOT touch the prompt input. Index is computed from messagesRef (always
// fresh via the setMessages wrapper) so callers don't need to worry about
// stale closures.
// Behavior equivalent to the REPL.tsx:4639-4692 useCallback body. REPL keeps the useCallback thin wrapper (deps unchanged).
export function rewindConversationTo(
	message: UserMessage,
	setters: RewindMessageSetters,
): void {
	const prev = setters.messagesRef.current;
	const messageIndex = prev.lastIndexOf(message);
	if (messageIndex === -1) return;
	logEvent("fusion_conversation_rewind", {
		preRewindMessageCount: prev.length,
		postRewindMessageCount: messageIndex,
		messagesRemoved: prev.length - messageIndex,
		rewindToMessageIndex: messageIndex,
	});
	setters.setMessages(prev.slice(0, messageIndex));
	// Careful, this has to happen after setMessages
	setters.setConversationId(randomUUID());
	// Reset cached microcompact state so stale pinned cache edits
	// don't reference tool_use_ids from truncated messages
	resetMicrocompactState();
	if (feature("CONTEXT_COLLAPSE")) {
		// Rewind truncates the REPL array. Commits whose archived span
		// was past the rewind point can't be projected anymore
		// (projectView silently skips them) but the staged queue and ID
		// maps reference stale uuids. Simplest safe reset: drop
		// everything. The ctx-agent will re-stage on the next
		// threshold crossing.
		/* eslint-disable @typescript-eslint/no-require-imports */
		(
			require("../services/contextCollapse/index.js") as typeof import("../services/contextCollapse/index.js")
		).resetContextCollapse();
		/* eslint-enable @typescript-eslint/no-require-imports */
	}

	// Restore state from the message we're rewinding to
	setters.setAppState((prev) => ({
		...prev,
		// Restore permission mode from the message
		toolPermissionContext:
			message.permissionMode &&
			prev.toolPermissionContext.mode !== message.permissionMode
				? {
						...prev.toolPermissionContext,
						mode: message.permissionMode,
					}
				: prev.toolPermissionContext,
		// Clear stale prompt suggestion from previous conversation state
		promptSuggestion: {
			text: null,
			promptId: null,
			shownAt: 0,
			acceptedAt: 0,
			generationRequestId: null,
		},
	}));
}

// Synchronous rewind + input population. Used directly by auto-restore on
// interrupt (so React batches with the abort's setMessages → single render,
// no flicker). MessageSelector wraps this in setImmediate via handleRestoreMessage.
// Behavior equivalent to the REPL.tsx:4698-4732 useCallback body.
export function restoreMessageSync(
	message: UserMessage,
	setters: RestoreMessageSetters,
): void {
	rewindConversationTo(message, setters);
	const r = textForResubmit(message);
	if (r) {
		setters.setInputValue(r.text);
		setters.setInputMode(r.mode);
	}

	// Restore pasted images
	if (
		Array.isArray(message.message.content) &&
		message.message.content.some((block) => block.type === "image")
	) {
		const imageBlocks: Array<ImageBlockParam> = message.message.content.filter(
			(block) => block.type === "image",
		);
		if (imageBlocks.length > 0) {
			const newPastedContents: Record<number, PastedContent> = {};
			imageBlocks.forEach((block, index) => {
				if (block.source.type === "base64") {
					const id = message.imagePasteIds?.[index] ?? index + 1;
					newPastedContents[id] = {
						id,
						type: "image",
						content: block.source.data,
						mediaType: block.source.media_type,
					};
				}
			});
			setters.setPastedContents(newPastedContents);
		}
	}
}
