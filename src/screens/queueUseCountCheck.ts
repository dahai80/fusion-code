// audit 1.1.1 slice #44: promptQueueUseCount analytics useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41/#42/#43).
// REPL() tracks prompt queue usage: fire-once saveGlobalConfig(promptQueueUseCount++) on the empty→non-empty transition.
// Prevents render-loop spam of saveGlobalConfig → ELOCKED → ~/.claude.json corruption (GH #3117).
// Original useEffect body. hasCountedQueueUseRef (ref) + queueLen (queuedCommands.length, derived dep) passed via ctx, byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// saveGlobalConfig (utils/config.js) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import not removed).
// No JSX → .ts. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [queuedCommands.length] unchanged (hasCountedQueueUseRef is a ref, stable, safe to omit; queueLen is the derived dep, matching the original).

import type { MutableRefObject } from "react";
import { saveGlobalConfig } from "../utils/config.js";

type QueueUseCountCheckCtx = {
	hasCountedQueueUseRef: MutableRefObject<boolean>;
	queueLen: number;
};

// REPL keeps the useEffect thin shell:
//   const hasCountedQueueUseRef = useRef(false);
//   useEffect(() => maybeCountQueueUse({ hasCountedQueueUseRef, queueLen: queuedCommands.length }), [queuedCommands.length]);
export function maybeCountQueueUse(ctx: QueueUseCountCheckCtx): void {
	if (ctx.queueLen < 1) {
		ctx.hasCountedQueueUseRef.current = false;
		return;
	}
	if (ctx.hasCountedQueueUseRef.current) return;
	ctx.hasCountedQueueUseRef.current = true;
	saveGlobalConfig((current) => ({
		...current,
		promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1,
	}));
}
