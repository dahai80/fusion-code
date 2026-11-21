// audit 1.1.1 slice #69: resume fork plan-copy if/else sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #9).
// resume() useCallback body sub-block (REPL L1903-1910, 8 LOC): entrypoint === "fork" branch —
// void copyPlanForFork(log, asSessionId(sessionId)) [fork: generates a new plan slug + copies plan content, original/fork don't overwrite each other];
// else — void copyPlanForResume(log, asSessionId(sessionId)) [plain resume: reuses the original session's plan slug].
// slice #61-#68 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (entrypoint, log, sessionId) passed via ctx, byte-equivalent behavior.
// copyPlanForFork/copyPlanForResume (plans.ts import block) + asSessionId (types/ids) imported directly
// (not REPL state, per imported-helpers-directly rule; REPL no longer uses them — but import cleanup is handled by a later slice, so this slice keeps the REPL import as multi-use for now).
// Helper returns void (both branches are fire-and-forget void). No JSX → .ts.
// Note: this is chunk #9 of the resume chunked extraction (fork plan copy if/else).

import type { UUID } from "node:crypto";
import type { ResumeEntrypoint } from "../commands.js";
import { asSessionId } from "../types/ids.js";
import type { LogOption } from "../types/logs.js";
import { copyPlanForFork, copyPlanForResume } from "../utils/plans.js";

type ResumePlanCopyCtx = {
	entrypoint: ResumeEntrypoint;
	log: LogOption;
	sessionId: UUID;
};

export function copyResumePlan(ctx: ResumePlanCopyCtx): void {
	if (ctx.entrypoint === "fork") {
		void copyPlanForFork(ctx.log, asSessionId(ctx.sessionId));
	} else {
		void copyPlanForResume(ctx.log, asSessionId(ctx.sessionId));
	}
}
