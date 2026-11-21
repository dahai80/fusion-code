// audit 1.1.1 slice #70: resume file-history restore sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #10).
// resume() useCallback body sub-block (REPL L1906-1910, 5 LOC): restoreSessionStateFromLog(log, setAppState)
// [restores file history + attribution state from the resumed conversation] +
// if (log.fileHistorySnapshots) void copyFileHistoryForResume(log) [copies file history into the new session when snapshots exist].
// slice #61-#69 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (log) + REPL state (setAppState) passed via ctx, byte-equivalent behavior.
// restoreSessionStateFromLog (sessionRestore import) + copyFileHistoryForResume (fileHistory import) imported directly
// (not REPL state, per imported-helpers-directly rule; copyFileHistoryForResume has a sole REPL user → the REPL import is removed after this slice,
//  FileHistorySnapshot/FileHistoryState still have multiple REPL uses, kept).
// restoreSessionStateFromLog's parameter type ResumeResult is a non-exported internal sessionRestore type — the REPL call site passing log: LogOption is byte-equivalent
// (LogOption structurally satisfies ResumeResult, current compilation passes); this helper passes log: LogOption through and does not export the internal type (same rule as ReturnType).
// Helper returns void (restoreSessionStateFromLog is void + void fire-and-forget copyFileHistoryForResume). No JSX → .ts.
// Note: this is chunk #10 of the resume chunked extraction (file-history restore).

import type { LogOption } from "../types/logs.js";
import { copyFileHistoryForResume } from "../utils/fileHistory.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import { restoreSessionStateFromLog } from "../utils/sessionRestore.js";

type ResumeFileHistoryRestoreCtx = {
	log: LogOption;
	setAppState: SetAppState;
};

export function restoreResumeFileHistory(
	ctx: ResumeFileHistoryRestoreCtx,
): void {
	restoreSessionStateFromLog(ctx.log, ctx.setAppState);
	if (ctx.log.fileHistorySnapshots) {
		void copyFileHistoryForResume(ctx.log);
	}
}
