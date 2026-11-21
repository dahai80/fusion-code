// audit 1.1.1: composedOnScroll wrapper extracted from REPL.tsx, pure routing. No React hooks,
// no JSX, no await. Only side effects = mutate lastUserScrollTsRef.current + call the 3
// callbacks + setAppState (identical to the original useCallback body).
// Semantics: timestamp on user scroll; sticky→onRepin (re-pin to bottom); non-sticky→onScrollAway +
//   (KAIROS) maybeLoadOlder lazy-loads history + (BUDDY) clears the companionReaction bubble on scroll
//   (absolute positioning covers the transcript; scrolling = the user wants to read content below).
// feature("KAIROS")/feature("BUDDY") = bun:bundle compile-time DCE macros (literal arguments, usable
//   in any file, already used in several utils). Non-KAIROS/BUDDY build branches are DCE'd away.
// Original useCallback deps = [onRepin, onScrollAway, maybeLoadOlder, setAppState]
//   (feature() is a compile macro and not in deps); REPL keeps the thin wrapper, downstream reads the same const (byte-equivalent).

import { feature } from "bun:bundle";
import type { ScrollBoxHandle } from "../ink/components/ScrollBox.js";
import type { AppState } from "../state/AppStateStore.js";

// setAppState = zustand store.setState, updater receives prev → full AppState (REPL expanded form).
// Only clears the companionReaction field (BUDDY branch); returns prev unchanged when undefined (no change).
export type ComposedOnScrollSetters = {
	lastUserScrollTsRef: { current: number };
	onRepin: () => void;
	onScrollAway: (handle: ScrollBoxHandle) => void;
	maybeLoadOlder: (handle: ScrollBoxHandle) => void;
	setAppState: (updater: (prev: AppState) => AppState) => void;
};

// Compose useUnseenDivider's callbacks with the lazy-load trigger + companion
// bubble dismissal. Behavior equivalent to the REPL.tsx:1532-1556 useCallback body. REPL keeps
// the useCallback thin wrapper (deps [onRepin, onScrollAway, maybeLoadOlder, setAppState] unchanged).
export function applyComposedOnScroll(
	sticky: boolean,
	handle: ScrollBoxHandle,
	setters: ComposedOnScrollSetters,
): void {
	setters.lastUserScrollTsRef.current = Date.now();
	if (sticky) {
		setters.onRepin();
	} else {
		setters.onScrollAway(handle);
		if (feature("KAIROS")) setters.maybeLoadOlder(handle);
		// Dismiss the companion bubble on scroll — it's absolute-positioned
		// at bottom-right and covers transcript content. Scrolling = user is
		// trying to read something under it.
		if (feature("BUDDY")) {
			setters.setAppState((prev) =>
				prev.companionReaction === undefined
					? prev
					: {
							...prev,
							companionReaction: undefined,
						},
			);
		}
	}
}
