// audit 1.1.1 slice #72: resume finalize UI-state + success-telemetry sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume chunked-extraction #12).
// resume() useCallback body sub-block (REPL L1998-2007, 9 LOC): setMessages(() => messages) [resets messages to the deserialized resumed conversation,
//  callback form avoids stale state] + setToolJSX(null) [clears the active tool JSX overlay; plain null is byte-equivalent to the applyToolJSXUpdate null branch] +
// setInputValue("") [clears leftover input] + logEvent("fusion_session_resumed", {entrypoint, success:true, resume_duration_ms}) [success telemetry, timed from resumeStart].
// slice #61-#71 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (messages, entrypoint, resumeStart) + REPL state (setMessages/setToolJSX/setInputValue) passed via ctx, byte-equivalent behavior.
// logEvent (analytics import) imported directly (not REPL state, per imported-helpers-directly rule; logEvent shared in 9 REPL places, REPL import kept; AnalyticsMetadata type shared in 7 REPL places, kept).
// resumeStart (body-local number outside the resume try, L1863) passed via ctx (the helper holds no resume state); the catch-branch logEvent(success:false) stays in REPL (coupled to the try structure, doesn't use resumeStart).
// setMessages param SetStateAction<MessageType[]> (REPL L1344 useCallback signature, import from react); setToolJSX param SetToolJSXArgs (setToolJSXWrapper exported type, null is legal);
// setInputValue param string (REPL L1473 useCallback signature).
// Helper returns void. No JSX → .ts.
// Note: this is chunk #12 of the resume chunked extraction (finalize UI reset + success telemetry). What remains of the resume() body here: the restoreReadFileState 1-call + loading-clear 3-setter trio +
// the setCostStateForRestore guarded 1-call + the try/catch envelope (structural glue, left in REPL per the thin-wrapper-skip rule).

import type { SetStateAction } from "react";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	logEvent,
} from "src/services/analytics/index.js";
import type { ResumeEntrypoint } from "../commands.js";
import type { Message as MessageType } from "../types/message.js";
import type { SetToolJSXArgs } from "../utils/setToolJSXWrapper.js";

type SetMessagesFn = (action: SetStateAction<MessageType[]>) => void;
type SetToolJSXFn = (args: SetToolJSXArgs) => void;
type SetInputValueFn = (value: string) => void;

type ResumeFinalizeCtx = {
	messages: MessageType[];
	entrypoint: ResumeEntrypoint;
	resumeStart: number;
	setMessages: SetMessagesFn;
	setToolJSX: SetToolJSXFn;
	setInputValue: SetInputValueFn;
};

export function finalizeResume(ctx: ResumeFinalizeCtx): void {
	ctx.setMessages(() => ctx.messages);
	ctx.setToolJSX(null);
	ctx.setInputValue("");
	logEvent("fusion_session_resumed", {
		entrypoint:
			ctx.entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
		success: true,
		resume_duration_ms: Math.round(performance.now() - ctx.resumeStart),
	});
}
