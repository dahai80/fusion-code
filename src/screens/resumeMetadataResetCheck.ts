// audit 1.1.1 slice #66: resume metadata-clear + haiku-reset sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #6).
// resume() useCallback body sub-block (REPL L1973-1979, 7 LOC): clearSessionMetadata() [clears the current session metadata so exit-time reAppendSessionMetadata re-appends it]
// + restoreSessionMetadata(log) [restores the target session metadata from log, set-if-truthy only] +
// haikuTitleAttemptedRef.current = true [marks the Haiku title as attempted; resume should not rename again from mid-session context] +
// setHaikuTitle(undefined) [clears the previous session's Haiku title, not carried over].
// slice #61-#65 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (log) + REPL state ref/setter
// (haikuTitleAttemptedRef/setHaikuTitle) passed via ctx, byte-equivalent behavior.
// clearSessionMetadata/restoreSessionMetadata (sessionStorage import block) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept).
// haikuTitleAttemptedRef is a useRef<boolean> ref OBJECT → stable, passed via ctx (not in deps). setHaikuTitle is a useState setter → passed via ctx.
// Helper returns void (pure synchronous setter chain). No JSX → .ts.
// Note: this is chunk #6 of the resume chunked extraction (metadata-clear + haiku-reset, purely synchronous, least dependencies).

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { LogOption } from "../types/logs.js";
import {
	clearSessionMetadata,
	restoreSessionMetadata,
} from "../utils/sessionStorage.js";

type ResumeMetadataResetCtx = {
	log: LogOption;
	haikuTitleAttemptedRef: MutableRefObject<boolean>;
	setHaikuTitle: Dispatch<SetStateAction<string | undefined>>;
};

export function resetResumeMetadata(ctx: ResumeMetadataResetCtx): void {
	clearSessionMetadata();
	restoreSessionMetadata(ctx.log);
	ctx.haikuTitleAttemptedRef.current = true;
	ctx.setHaikuTitle(undefined);
}
