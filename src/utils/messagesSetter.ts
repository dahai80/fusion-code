// audit 1.1.1: setMessages wrapping pure routing extracted from REPL.tsx. No React hooks, no JSX,
// no await. The only side effects = mutate 3 ref.currents + call rawSetMessages (identical to the
// original useCallback body).
// Semantics: maintain messagesRef (mirror of the latest message array, closure-safe) + userInputBaselineRef/
//   userMessagePendingRef (baseline for the user-message placeholder). The callback body does three things:
//   (1) compute next (functional action or direct assignment), sync messagesRef.current;
//   (2) if next shrank (compact/rewind/clear) -> clamp baseline to 0 (prevents a stale placeholder);
//   (3) if next grew and userMessagePending -> check whether the added items contain a human turn:
//       yes -> pending=false (user message landed, stop tracking); no -> bump baseline=next.length
//       (async bridge/hook/scheduled tasks landing before the user message -> placeholder stays visible).
//   Finally rawSetMessages(next) triggers the React re-render.
// Original useCallback deps = [] (everything goes through refs + rawSetMessages, no closure captures). REPL keeps the thin wrapper,
//   deps [] unchanged (helper has no React); downstream reads the same-name const (byte-equivalent).
import type { Message as MessageType } from "../types/message.js";
import { isHumanTurn } from "./messagePredicates.js";

// Three refs mirror React state, read/written inside the callback body (avoids stale closure).
// messagesRef: latest messages array; userInputBaselineRef: placeholder baseline length;
//   userMessagePendingRef: whether the user message has not yet landed.
export type MessagesSetterRefs = {
	messagesRef: { current: MessageType[] };
	userInputBaselineRef: { current: number };
	userMessagePendingRef: { current: boolean };
};

export type MessagesSetterSetters = MessagesSetterRefs & {
	rawSetMessages: (next: MessageType[]) => void;
};

// Behavior-equivalent to the REPL.tsx:1431-1462 useCallback body. REPL keeps a thin useCallback wrapper
// (deps [] unchanged — the helper has no React dependency, everything goes through setters/refs).
export function applySetMessages(
	action: React.SetStateAction<MessageType[]>,
	setters: MessagesSetterSetters,
): void {
	const prev = setters.messagesRef.current;
	const next =
		typeof action === "function" ? action(setters.messagesRef.current) : action;
	setters.messagesRef.current = next;
	if (next.length < setters.userInputBaselineRef.current) {
		// Shrank (compact/rewind/clear) — clamp so placeholderText's length
		// check can't go stale.
		setters.userInputBaselineRef.current = 0;
	} else if (
		next.length > prev.length &&
		setters.userMessagePendingRef.current
	) {
		// Grew while the submitted user message hasn't landed yet. If the
		// added messages don't include it (bridge status, hook results,
		// scheduled tasks landing async during processUserInputBase), bump
		// baseline so the placeholder stays visible. Once the user message
		// lands, stop tracking — later additions (assistant stream) should
		// not re-show the placeholder.
		const delta = next.length - prev.length;
		const added =
			prev.length === 0 || next[0] === prev[0]
				? next.slice(-delta)
				: next.slice(0, delta);
		if (added.some(isHumanTurn)) {
			setters.userMessagePendingRef.current = false;
		} else {
			setters.userInputBaselineRef.current = next.length;
		}
	}
	setters.rawSetMessages(next);
}
