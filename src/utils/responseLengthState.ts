// audit 1.1.1: setResponseLength wrapping pure routing extracted from REPL.tsx. No React hooks, no JSX,
// no await. The only side effects = mutate 2 ref.currents (identical to the original useCallback body).
// Semantics: when the model's streamed output accumulates response length, three things happen:
//   (1) responseLengthRef.current = f(prev) (records the current turn's accumulated length, for pushApiMetricsEntry
//       to read the baseline + setResponseLength's own delta judgment);
//   (2) only when the new value > prev (length grew) does the last metrics entry update — flat periods (no new tokens)
//       do not refresh the timestamp;
//   (3) last entry lastTokenTime = now + endResponseLength = the current accumulated value (the ttft baseline is
//       set when pushApiMetricsEntry creates the entry; this only advances lastTokenTime + the final value, for the
//       TTFT->last-token duration + total response length stats).
// Original useCallback deps = [] (refs are not in deps; an empty array = never rebuilt). REPL keeps the thin wrapper, deps unchanged;
//   downstream reads the same-name const (byte-equivalent).

// Minimal ApiMetricsEntry shape (the helper only writes these two fields; reading the baseline is not done here).
type ApiMetricsEntryLike = {
	lastTokenTime: number;
	endResponseLength: number;
};

export type ResponseLengthStateSetters = {
	responseLengthRef: { current: number };
	apiMetricsRef: { current: ApiMetricsEntryLike[] };
};

// Behavior-equivalent to the REPL.tsx:1681-1696 useCallback body. REPL keeps a thin useCallback
// wrapper (deps [] unchanged).
export function applySetResponseLength(
	f: (prev: number) => number,
	setters: ResponseLengthStateSetters,
): void {
	const prev = setters.responseLengthRef.current;
	setters.responseLengthRef.current = f(prev);
	if (setters.responseLengthRef.current > prev) {
		const entries = setters.apiMetricsRef.current;
		if (entries.length > 0) {
			const lastEntry = entries.at(-1);
			if (lastEntry !== undefined) {
				lastEntry.lastTokenTime = Date.now();
				lastEntry.endResponseLength = setters.responseLengthRef.current;
			}
		}
	}
}
