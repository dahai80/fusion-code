// audit 1.1.1 slice #38: undercover-callout useEffect body extracted (INLINE-ASYNC-IIFE, 2nd — like slice #32 runImmediateCommand).
// REPL() mount-only: on internal build, checks repo classification + the undercover auto notice, and calls setShowUndercoverCallout(true) when satisfied.
// Original async IIFE inside useEffect. setShowUndercoverCallout passed via ctx (closure capture), byte-equivalent behavior.
// isInternalBuild (buildConstants) + 2 dynamic imports (commitAttribution/undercover) stay inside the helper (pure imports are not REPL state, per imported-helpers-directly rule).
// No JSX / no hook → .ts. Returns void (REPL thin shell calls it with void).

import { isInternalBuild } from "../utils/buildConstants.js";

type UndercoverCalloutCheckCtx = {
	setShowUndercoverCallout: (v: boolean) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => {
//     applyUndercoverCalloutCheck({ setShowUndercoverCallout });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);
// isInternalBuild() guard moved into the helper (not REPL state, pure import). deps [] unchanged, eslint-disable kept.
export function applyUndercoverCalloutCheck(
	ctx: UndercoverCalloutCheckCtx,
): void {
	if (isInternalBuild()) {
		void (async () => {
			// Wait for repo classification to settle (memoized, no-op if primed).
			const { isInternalModelRepo } = await import(
				"../utils/commitAttribution.js"
			);
			await isInternalModelRepo();
			const { shouldShowUndercoverAutoNotice } = await import(
				"../utils/undercover.js"
			);
			if (shouldShowUndercoverAutoNotice()) {
				ctx.setShowUndercoverCallout(true);
			}
		})();
	}
}
