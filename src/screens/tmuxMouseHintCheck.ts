// audit 1.1.1 slice #51: tmux mouse-off one-time hint useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#50).
// REPL() mount-once: isFullscreenEnvEnabled() → maybeGetTmuxMouseHint() async → if a hint exists, addNotification({key:"tmux-mouse-hint", text:hint, priority:"low"}).
// No longer mutates the tmux session-scoped mouse option (poisons sibling panes); tmux users already know this tradeoff.
// Original useEffect body. addNotification (deps trigger) passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out; deps [] unchanged (mount-once, eslint-disable-next-line react-hooks/exhaustive-deps kept).
// isFullscreenEnvEnabled + maybeGetTmuxMouseHint (utils/fullscreen) imported directly (not REPL state, per imported-helpers-directly rule; isFullscreenEnvEnabled used multiple times in REPL, REPL import kept; maybeGetTmuxMouseHint single use in REPL, REPL import removed after extraction).
// No JSX → .ts. Returns Promise<void> (REPL thin-shell useEffect pass-through, no cleanup).

import type { Notification } from "../context/notifications.js";
import {
	isFullscreenEnvEnabled,
	maybeGetTmuxMouseHint,
} from "../utils/fullscreen.js";

type TmuxMouseHintCheckCtx = {
	addNotification: (content: Notification) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => { void maybeShowTmuxMouseHint({ addNotification }); // eslint-disable-next-line react-hooks/exhaustive-deps }, []);
export async function maybeShowTmuxMouseHint(
	ctx: TmuxMouseHintCheckCtx,
): Promise<void> {
	if (!isFullscreenEnvEnabled()) {
		return;
	}
	const hint = await maybeGetTmuxMouseHint();
	if (hint) {
		ctx.addNotification({
			key: "tmux-mouse-hint",
			text: hint,
			priority: "low",
		});
	}
}
