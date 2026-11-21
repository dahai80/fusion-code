// audit 1.1.1 slice #42: worktree sparsePaths tip useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#41).
// REPL() detects slow worktree creation (>15s) with sparsePaths unused → one-time hint telling the user to configure worktree.sparsePaths.
// Original useEffect body. worktreeTipShownRef (ref) + setMessages passed via ctx (closure capture), byte-equivalent behavior.
// The useRef()/useEffect() hooks stay as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// getCurrentWorktreeSession (utils/worktree.js) + createSystemMessage imported directly (not REPL state, per imported-helpers-directly rule).
// No JSX → .ts. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [setMessages] unchanged (worktreeTipShownRef is a ref, stable, safe to omit, matching the original).

import type { MutableRefObject, SetStateAction } from "react";
import type { Message as MessageType } from "../types/message.js";
import { createSystemMessage } from "../utils/messages.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

type WorktreeTipCheckCtx = {
	worktreeTipShownRef: MutableRefObject<boolean>;
	setMessages: (action: SetStateAction<MessageType[]>) => void;
};

// REPL keeps the useEffect thin shell:
//   const worktreeTipShownRef = useRef(false);
//   useEffect(() => maybeShowWorktreeTip({ worktreeTipShownRef, setMessages }), [setMessages]);
export function maybeShowWorktreeTip(ctx: WorktreeTipCheckCtx): void {
	if (ctx.worktreeTipShownRef.current) return;
	const wt = getCurrentWorktreeSession();
	if (!wt?.creationDurationMs || wt.usedSparsePaths) return;
	if (wt.creationDurationMs < 15_000) return;
	ctx.worktreeTipShownRef.current = true;
	const secs = Math.round(wt.creationDurationMs / 1000);
	ctx.setMessages((prev) => [
		...prev,
		createSystemMessage(
			`Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .claude/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": ["src", "packages/foo"]}}\`.`,
			"info",
		),
	]);
}
