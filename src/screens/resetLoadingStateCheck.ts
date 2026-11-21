// audit 1.1.1 slice #55: resetLoadingState useCallback body extracted (INLINE-CALLBACK curried-factory, like #46/#49/#50/#53).
// REPL() resets loading/streaming/spinner state at turn end: external loading off + user-processing clear +
// response/metrics refs zeroed + streaming text/toolUses cleared + spinner cleared + new tip + end interaction span + clear speculative checks.
// Original useCallback body. setIsExternalLoading (useCallback-wrapped) + setUserInputOnProcessing (useCallback-wrapped) +
// responseLengthRef/apiMetricsRef (useRef objects, stable refs) + setStreamingText/setStreamingToolUses/setSpinnerMessage/
// setSpinnerColor/setSpinnerShimmerColor (useState setters) + pickNewSpinnerTip (REPL-local useCallback) passed via ctx (closure capture), byte-equivalent behavior.
// The useCallback() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the callback body moves out (curried factory returns the fn, REPL useCallback wraps it once more and passes it through).
// endInteractionSpan (utils/telemetry/sessionTracing) + clearSpeculativeChecks (tools/BashTool/bashPermissions) imported directly
// (not REPL state, per imported-helpers-directly rule; single use in REPL, REPL import removed after extraction).
// ctx types: setIsExternalLoading/setUserInputOnProcessing are useCallback-wrapped (not raw useState setters), use their precise signatures
// (value: boolean)/(input: string|undefined), not Dispatch<SetStateAction> (#53 lesson: narrow from the useCallback decl, not a loose string).
// responseLengthRef: MutableRefObject<number>; apiMetricsRef: MutableRefObject<Array<{...}>> (element shape copied, ref object stable).
// No JSX → .ts. Returns () => void (REPL thin-shell useCallback pass-through).
// deps [pickNewSpinnerTip] unchanged (remaining setters/refs are stable, pickNewSpinnerTip is a REPL-local useCallback dep).

import type { MutableRefObject } from "react";
import type { Theme } from "src/utils/theme.js";
import { clearSpeculativeChecks } from "../tools/BashTool/bashPermissions.js";
import type { StreamingToolUse } from "../utils/messages.js";
import { endInteractionSpan } from "../utils/telemetry/sessionTracing.js";

type ApiMetricEntry = {
	ttftMs: number;
	firstTokenTime: number;
	lastTokenTime: number;
	responseLengthBaseline: number;
	endResponseLength: number;
};

type ResetLoadingStateCtx = {
	setIsExternalLoading: (value: boolean) => void;
	setUserInputOnProcessing: (input: string | undefined) => void;
	responseLengthRef: MutableRefObject<number>;
	apiMetricsRef: MutableRefObject<ApiMetricEntry[]>;
	setStreamingText: (
		value: string | null | ((prev: string | null) => string | null),
	) => void;
	setStreamingToolUses: (
		value:
			| StreamingToolUse[]
			| ((prev: StreamingToolUse[]) => StreamingToolUse[]),
	) => void;
	setSpinnerMessage: (
		value: string | null | ((prev: string | null) => string | null),
	) => void;
	setSpinnerColor: (
		value:
			| keyof Theme
			| null
			| ((prev: keyof Theme | null) => keyof Theme | null),
	) => void;
	setSpinnerShimmerColor: (
		value:
			| keyof Theme
			| null
			| ((prev: keyof Theme | null) => keyof Theme | null),
	) => void;
	pickNewSpinnerTip: () => void;
};

// REPL keeps the useCallback thin shell:
//   const resetLoadingState = useCallback(
//     () => createResetLoadingState({ setIsExternalLoading, setUserInputOnProcessing, responseLengthRef, apiMetricsRef, setStreamingText, setStreamingToolUses, setSpinnerMessage, setSpinnerColor, setSpinnerShimmerColor, pickNewSpinnerTip })(),
//     [pickNewSpinnerTip],
//   );
export function createResetLoadingState(ctx: ResetLoadingStateCtx): () => void {
	return () => {
		// isLoading is now derived from queryGuard — no setter call needed.
		// queryGuard.end() (onQuery finally) or cancelReservation() (executeUserInput
		// finally) have already transitioned the guard to idle by the time this runs.
		// External loading (remote/backgrounding) is reset separately by those hooks.
		ctx.setIsExternalLoading(false);
		ctx.setUserInputOnProcessing(undefined);
		ctx.responseLengthRef.current = 0;
		ctx.apiMetricsRef.current = [];
		ctx.setStreamingText(null);
		ctx.setStreamingToolUses([]);
		ctx.setSpinnerMessage(null);
		ctx.setSpinnerColor(null);
		ctx.setSpinnerShimmerColor(null);
		ctx.pickNewSpinnerTip();
		endInteractionSpan();
		// Speculative bash classifier checks are only valid for the current
		// turn's commands — clear after each turn to avoid accumulating
		// Promise chains for unconsumed checks (denied/aborted paths).
		clearSpeculativeChecks();
	};
}
