// audit 1.1.1: idle-return gate block extracted from REPL.tsx onSubmit (PURE-ROUTING SUB-BLOCK class, like slice #25/#26).
// Behavior-equivalent to REPL.tsx:3865-3900 (block-scope {}). No React hooks, no JSX, no await.
// idle-return: on long conversations + cold cache, guide returning users to start a new session. Controlled by fusion_willow_mode: "dialog" (blocking)/"hint"/"off".
// Only when willowMode!=="off" && !idleReturnDismissed && !skipIdleCheckRef && !speculationAccept
//   && not a slash-command && lastQueryCompletionTime>0 && totalTokens>=tokenThreshold:
//   idleMinutes = (now - lastQueryCompletionTime)/60000;
//   if idleMinutes >= idleThresholdMin && willowMode==="dialog" →
//     setIdleReturnPending({input, idleMinutes}) + setInputValue("") + helpers.setCursorOffset(0) + helpers.clearBuffer() + return true (early-exit signal).
// Returns boolean: true = dialog early-exit triggered (REPL return), false = not triggered (REPL continues).
// ctx carries REPL closure deps (skipIdleCheckRef + lastQueryCompletionTimeRef + speculationAccept + setIdleReturnPending + setInputValue + helpers);
//   input is the onSubmit parameter. getFeatureValue_CACHED_MAY_BE_STALE/getGlobalConfig/getTotalInputTokens are standalone module imports.
import { getTotalInputTokens } from "../bootstrap/state.js";
import { getFeatureValue_CACHED_MAY_BE_STALE } from "../services/analytics/index.js";
import type { ActiveSpeculationState } from "../services/PromptSuggestion/index.js";
import { getGlobalConfig } from "./config.js";
import type { PromptInputHelpers } from "./handlePromptSubmit.js";
import type { SetAppState } from "./messageQueueManager.js";

type IdleReturnCtx = {
	skipIdleCheckRef: { current: boolean };
	lastQueryCompletionTimeRef: { current: number };
	speculationAccept?: {
		state: ActiveSpeculationState;
		speculationSessionTimeSavedMs: number;
		setAppState: SetAppState;
	};
	setIdleReturnPending: (val: { input: string; idleMinutes: number }) => void;
	setInputValue: (val: string) => void;
	helpers: PromptInputHelpers;
};

// REPL keeps a thin call site:
//   if (maybeTriggerIdleReturnDialog(input, { skipIdleCheckRef, lastQueryCompletionTimeRef, speculationAccept, setIdleReturnPending, setInputValue, helpers })) return;
export function maybeTriggerIdleReturnDialog(
	input: string,
	ctx: IdleReturnCtx,
): boolean {
	const willowMode = getFeatureValue_CACHED_MAY_BE_STALE(
		"fusion_willow_mode",
		"off",
	);
	const idleThresholdMin = Number(
		process.env.FUSION_CODE_IDLE_THRESHOLD_MINUTES ?? 75,
	);
	const tokenThreshold = Number(
		process.env.FUSION_CODE_IDLE_TOKEN_THRESHOLD ?? 100_000,
	);
	if (
		willowMode !== "off" &&
		!getGlobalConfig().idleReturnDismissed &&
		!ctx.skipIdleCheckRef.current &&
		!ctx.speculationAccept &&
		!input.trim().startsWith("/") &&
		ctx.lastQueryCompletionTimeRef.current > 0 &&
		getTotalInputTokens() >= tokenThreshold
	) {
		const idleMs = Date.now() - ctx.lastQueryCompletionTimeRef.current;
		const idleMinutes = idleMs / 60_000;
		if (idleMinutes >= idleThresholdMin && willowMode === "dialog") {
			ctx.setIdleReturnPending({
				input,
				idleMinutes,
			});
			ctx.setInputValue("");
			ctx.helpers.setCursorOffset(0);
			ctx.helpers.clearBuffer();
			return true;
		}
	}
	return false;
}
