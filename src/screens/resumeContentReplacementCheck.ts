// audit 1.1.1 slice #61: resume content-replacement reconstruct sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #1).
// resume() useCallback body sub-block (REPL L2071-2077): after reading the feature flag, ref.current is truthy + entrypoint is not fork →
// reconstructContentReplacementState(messages, log.contentReplacements ?? []) rewrites ref.current so that new replacements after resume write into the resumed session directory.
// slice #43/#60 sibling pattern: a small cohesive sub-block cut out of a large useCallback; resume-local variables passed via ctx (closure capture), byte-equivalent behavior.
// contentReplacementStateRef (REPL useState ref object L1653, {current: ContentReplacementState}) + entrypoint (resume param ResumeEntrypoint) +
// messages (resume-local MessageType[], deserializeMessages return) + contentReplacements (the already-spread value of log.contentReplacements ?? [], ContentReplacementRecord[]) passed via ctx.
// reconstructContentReplacementState (utils/toolResultStorage) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL at L417, REPL import kept).
// Helper returns void (mutates ref.current directly, matching the original). No JSX → .ts. No deps (called inside the resume body, not a hook).
// Note: this is chunk #1 of the resume multi-session chunked extraction (the smallest + least-dependent of the 4, 1 ref + 3 resume-local values). #62+ later extract 1876-1906/1950-1970/1980-2002.

import type { ResumeEntrypoint } from "../commands.js";
import type { Message as MessageType } from "../types/message.js";
import type {
	ContentReplacementRecord,
	ContentReplacementState,
} from "../utils/toolResultStorage.js";
import { reconstructContentReplacementState } from "../utils/toolResultStorage.js";

type ResumeContentReplacementCtx = {
	contentReplacementStateRef: { current: ContentReplacementState };
	entrypoint: ResumeEntrypoint;
	messages: MessageType[];
	contentReplacements: ContentReplacementRecord[];
};

// REPL keeps the resume() thin shell:
//   if (contentReplacementStateRef.current && entrypoint !== "fork") {
//     reconstructResumeContentReplacement({ contentReplacementStateRef, entrypoint, messages, contentReplacements: log.contentReplacements ?? [] });
//   }
export function reconstructResumeContentReplacement(
	ctx: ResumeContentReplacementCtx,
): void {
	ctx.contentReplacementStateRef.current = reconstructContentReplacementState(
		ctx.messages,
		ctx.contentReplacements,
	);
}
