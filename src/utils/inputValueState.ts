// audit 1.1.1: setInputValue wrapper extracted from REPL.tsx, pure routing. No React hooks, no JSX,
// no await. Only side effects = mutate 2 ref.currents + call 3 setters (identical to the original
// useCallback body).
// Semantics: three things on user input:
//   (1) trySuggestBgPRIntercept(prev, value) hit → early return (PR suggestion intercept, currently a
//       noop, reserved hook);
//   (2) empty→non-empty input AND last scroll ≥ RECENT_SCROLL_REPIN_WINDOW_MS (3s) ago → repinScroll
//       (typing re-pins to bottom in fullscreen mode; if the user scrolled within 3s = reading, do not steal the view back);
//   (3) sync inputValueRef.current (callers reading the ref before the React commit see the new value, e.g. the === ""
//       guard in the auto-restore finally block) + setInputValueRaw(value) + setIsPromptInputActive(non-empty).
// Original useCallback deps = [setIsPromptInputActive, repinScroll, trySuggestBgPRIntercept]
//   (refs are not in deps; setInputValueRaw is a stable useState setter). REPL keeps the thin wrapper, deps unchanged;
//   downstream reads the same const (byte-equivalent).

export type InputValueStateSetters = {
	trySuggestBgPRIntercept: (prev: string, next: string) => boolean;
	repinScroll: () => void;
	setInputValueRaw: (value: string) => void;
	setIsPromptInputActive: (active: boolean) => void;
	inputValueRef: { current: string };
	lastUserScrollTsRef: { current: number };
	recentScrollRepinWindowMs: number;
};

// Behavior equivalent to the REPL.tsx:1558-1585 useCallback body. REPL keeps the useCallback thin wrapper
// (deps [setIsPromptInputActive, repinScroll, trySuggestBgPRIntercept] unchanged).
export function applySetInputValue(
	value: string,
	setters: InputValueStateSetters,
): void {
	if (setters.trySuggestBgPRIntercept(setters.inputValueRef.current, value)) {
		return;
	}
	// In fullscreen mode, typing into an empty prompt re-pins scroll to
	// bottom. Only fires on empty→non-empty so scrolling up to reference
	// something while composing a message doesn't yank the view back on
	// every keystroke. Restores the pre-fullscreen muscle memory of
	// typing to snap back to the end of the conversation.
	// Skipped if the user scrolled within the last 3s — they're actively
	// reading, not lost. lastUserScrollTsRef starts at 0 so the first-
	// ever keypress (no scroll yet) always repins.
	if (
		setters.inputValueRef.current === "" &&
		value !== "" &&
		Date.now() - setters.lastUserScrollTsRef.current >=
			setters.recentScrollRepinWindowMs
	) {
		setters.repinScroll();
	}
	// Sync ref immediately (like setMessages) so callers that read
	// inputValueRef before React commits — e.g. the auto-restore finally
	// block's `=== ''` guard — see the fresh value, not the stale render.
	setters.inputValueRef.current = value;
	setters.setInputValueRaw(value);
	setters.setIsPromptInputActive(value.trim().length > 0);
}
