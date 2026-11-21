// audit 1.1.1 slice #65: resume worktree-restore if/else sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #5).
// resume() useCallback body sub-block (REPL L1990-2005, 16 LOC): entrypoint !== "fork" branch —
// exitRestoredWorktree() [exits the worktree previously entered via /resume] + restoreWorktreeForResume(log.worktreeSession)
// [cds back to the worktree this session lives in] + adoptResumedSessionFile() [adopts the resumed session file] +
// void restoreRemoteAgentTasks({abortController, getAppState, setAppState}) [restores remote agent tasks];
// else fork branch — getCurrentWorktreeSession() → ws ? saveWorktreeState(ws) [fork: like /clear, re-persists worktree state].
// slice #61-#64 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (entrypoint, log.worktreeSession) +
// the REPL-local fn (restoreRemoteAgentTasks no-op stub L426) passed via ctx, byte-equivalent behavior.
// exitRestoredWorktree/restoreWorktreeForResume/adoptResumedSessionFile/saveWorktreeState (sessionStorage import block) +
// getCurrentWorktreeSession (utils/worktree) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept).
// restoreRemoteAgentTasks is a REPL-local no-op stub (not an import) → passed via ctx, type narrowed to the call-site object shape.
// Helper returns void (both branches void). No JSX → .ts.
// Note: this is chunk #5 of the resume chunked extraction (worktree restore if/else, includes the fork branch).

import type { AppStateStore } from "../state/AppStateStore.js";
import type { PersistedWorktreeSession } from "../types/logs.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import {
	exitRestoredWorktree,
	restoreWorktreeForResume,
} from "../utils/sessionRestore.js";
import {
	adoptResumedSessionFile,
	saveWorktreeState,
} from "../utils/sessionStorage.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

type ResumeRemoteAgentTasksFn = (opts: {
	abortController: AbortController;
	getAppState: () => unknown;
	setAppState: SetAppState;
}) => Promise<void>;

type ResumeWorktreeRestoreCtx = {
	entrypoint: string;
	worktreeSession: PersistedWorktreeSession | null | undefined;
	restoreRemoteAgentTasks: ResumeRemoteAgentTasksFn;
	store: AppStateStore;
	setAppState: SetAppState;
};

export function restoreResumeWorktree(ctx: ResumeWorktreeRestoreCtx): void {
	if (ctx.entrypoint !== "fork") {
		exitRestoredWorktree();
		restoreWorktreeForResume(ctx.worktreeSession);
		adoptResumedSessionFile();
		void ctx.restoreRemoteAgentTasks({
			abortController: new AbortController(),
			getAppState: () => ctx.store.getState(),
			setAppState: ctx.setAppState,
		});
	} else {
		const ws = getCurrentWorktreeSession();
		if (ws) saveWorktreeState(ws);
	}
}
