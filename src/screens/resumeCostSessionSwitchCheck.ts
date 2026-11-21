// audit 1.1.1 slice #64: resume cost-save + session-switch sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #4 final).
// resume() useCallback body sub-block (REPL L1957-1979, 23 LOC): targetSessionCosts = getStoredSessionCosts(sessionId) [reads the target session costs before saveCurrentSessionCosts overwrites them]
// → saveCurrentSessionCosts() [saves the current session costs] → resetCostState() [clears cost state] →
// switchSession(asSessionId(sessionId), log.fullPath ? dirname(log.fullPath) : null) [atomically switches session id + project directory] →
// await import("../utils/asciicast.js").renameRecordingForSession() [renames the asciicast recording] → await resetSessionFilePointer() [resets the session file pointer].
// slice #61/#62/#63 sibling pattern: a large useCallback sub-block cut out; resume-local variables (sessionId, log.fullPath) passed via ctx,
// all side-effect calls moved into the helper. Helper returns targetSessionCosts (StoredCostState|undefined) — REPL keeps a const to receive it,
// because the later L2032 `if (targetSessionCosts) setCostStateForRestore(targetSessionCosts)` consumes this return value (73 lines later).
// The return value flows out via the helper return + REPL const, threading keeps byte equivalence (return-value-threading pattern, first instance).
// getStoredSessionCosts/saveCurrentSessionCosts/resetCostState (cost-tracker) + switchSession (bootstrap/state) +
// resetSessionFilePointer (utils/sessionStorage) + asSessionId (types/ids) + dirname (path) imported directly
// (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept).
// StoredCostState is a non-exported internal cost-tracker type → derived via ReturnType<typeof getStoredSessionCosts> (zero file changes, type-safe).
// await import("../utils/asciicast.js") dynamic import stays inside the helper (original style).
// Helper returns Promise<StoredCostState | undefined> (contains await, REPL awaits the call). No JSX → .ts.
// Note: this is chunk #4 of the resume multi-session chunked extraction (the last one, includes return-value-threading). All 4 resume() chunks extracted.

import type { UUID } from "node:crypto";
import { dirname } from "node:path";
import { switchSession } from "../bootstrap/state.js";
import {
	getStoredSessionCosts,
	resetCostState,
	saveCurrentSessionCosts,
} from "../cost-tracker.js";
import { asSessionId } from "../types/ids.js";
import { resetSessionFilePointer } from "../utils/sessionStorage.js";

type ResumeCostSessionSwitchCtx = {
	sessionId: UUID;
	fullPath: string | undefined;
};

// REPL keeps the resume() thin shell (return-value-threading):
//   const targetSessionCosts = await saveAndSwitchResumeSession({
//     sessionId,
//     fullPath: log.fullPath,
//   });
//   ... (later at L2032: if (targetSessionCosts) setCostStateForRestore(targetSessionCosts); kept as-is)
export async function saveAndSwitchResumeSession(
	ctx: ResumeCostSessionSwitchCtx,
): Promise<ReturnType<typeof getStoredSessionCosts>> {
	const targetSessionCosts = getStoredSessionCosts(ctx.sessionId);
	saveCurrentSessionCosts();
	resetCostState();
	switchSession(
		asSessionId(ctx.sessionId),
		ctx.fullPath ? dirname(ctx.fullPath) : null,
	);
	const { renameRecordingForSession } = await import("../utils/asciicast.js");
	await renameRecordingForSession();
	await resetSessionFilePointer();
	return targetSessionCosts;
}
