// audit 1.1.1 slice #71: resume standalone agent context sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume chunked-extraction #11).
// resume() useCallback body sub-block (REPL L1916-1926, 11 LOC): setAppState(prev => ({...prev,
// standaloneAgentContext: computeStandaloneAgentContext(log.agentName, log.agentColor)}))
// [restores the standalone agent context from the resumed conversation; always resets to the new session's value or clears it] +
// void updateSessionName(log.agentName) [persists the session name to the pid file].
// slice #61-#70 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (log) + REPL state (setAppState) passed via ctx, byte-equivalent behavior.
// computeStandaloneAgentContext (sessionRestore import) + updateSessionName (concurrentSessions import) imported directly
// (not REPL state, per imported-helpers-directly rule; both have a sole REPL user → the REPL imports are removed after this slice).
// Helper returns void (setAppState void + void fire-and-forget updateSessionName). No JSX → .ts.
// Note: this is chunk #11 of the resume chunked extraction (standalone agent context restore).

import type { LogOption } from "../types/logs.js";
import { updateSessionName } from "../utils/concurrentSessions.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import { computeStandaloneAgentContext } from "../utils/sessionRestore.js";

type ResumeStandaloneAgentCtx = {
	log: LogOption;
	setAppState: SetAppState;
};

export function restoreResumeStandaloneAgent(
	ctx: ResumeStandaloneAgentCtx,
): void {
	ctx.setAppState((prev) => ({
		...prev,
		standaloneAgentContext: computeStandaloneAgentContext(
			ctx.log.agentName,
			ctx.log.agentColor,
		),
	}));
	void updateSessionName(ctx.log.agentName);
}
