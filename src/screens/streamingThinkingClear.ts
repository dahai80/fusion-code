// audit 1.1.1 slice #39: streamingThinking auto-hide useEffect body extracted (full-useEffect-body-returns-timer-handle variant, 3rd — like slice #34 maybeScheduleIdleReturnHint / #35 maybeScheduleSafeYoloMessage).
// REPL() auto-hides streaming thinking 30s after completion: finished (isStreaming=false + streamingEndedAt present) → compute remaining from elapsed → remaining>0 sets setTimeout(setStreamingThinking, remaining, null) and returns cleanup, otherwise clears immediately.
// Original useEffect body. streamingThinking + setStreamingThinking passed via ctx (closure capture), byte-equivalent behavior.
// StreamingThinking (messages.js) imported directly (not REPL state, per imported-helpers-directly rule).
// No JSX / no hook → .ts. Returns (() => void) | undefined (REPL thin-shell useEffect pass-through cleanup).

import type { StreamingThinking } from "../utils/messages.js";

type StreamingThinkingClearCtx = {
	streamingThinking: StreamingThinking | null;
	setStreamingThinking: (v: StreamingThinking | null) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => maybeClearStreamingThinking({ streamingThinking, setStreamingThinking }), [streamingThinking]);
// deps [streamingThinking] unchanged (setStreamingThinking is a useState setter, stable ref, safe to omit, matching the original).
export function maybeClearStreamingThinking(
	ctx: StreamingThinkingClearCtx,
): (() => void) | undefined {
	if (
		ctx.streamingThinking &&
		!ctx.streamingThinking.isStreaming &&
		ctx.streamingThinking.streamingEndedAt
	) {
		const elapsed = Date.now() - ctx.streamingThinking.streamingEndedAt;
		const remaining = 30000 - elapsed;
		if (remaining > 0) {
			const timer = setTimeout(ctx.setStreamingThinking, remaining, null);
			return () => clearTimeout(timer);
		} else {
			ctx.setStreamingThinking(null);
		}
	}
	return undefined;
}
