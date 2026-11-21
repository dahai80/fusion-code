// audit 1.1.1: pure routing extracted from REPL.tsx getToolUseContext.onCompactProgress.
// No React hooks, no JSX, no await. The only side effect = calling the 3 spinner setters
// (setSpinnerColor/Shimmer/Message). Semantics: compact lifecycle events → spinner text/color.
//   hooks_start: system blue spinner + text chosen by hookType (pre/post_compact/session_start);
//   compact_start: "Compacting conversation";
//   compact_retry: "Compacting (retry N/M: <reason>)" (item 16 makes trim retries visible);
//   compact_stall: show elapsed-time text only after COMPACT_STALL_HINT_MS (item 16 shows elapsed time when there is no token stream past the threshold);
//   compact_end: clear the spinner (message/color/shimmer all null).
// formatDuration + COMPACT_STALL_HINT_MS are REPL-local, passed in externally via setters to keep byte equivalence.
// REPL keeps the onCompactProgress inline callback (closure over the spinner setters) and calls this helper once.

import type { Theme } from "src/utils/theme.js";
import type { CompactProgressEvent } from "../Tool.js";
import { formatDuration } from "./format.js";

type SpinnerSetter = {
	setSpinnerColor: (v: keyof Theme | null) => void;
	setSpinnerShimmerColor: (v: keyof Theme | null) => void;
	setSpinnerMessage: (v: string | null) => void;
};

export type CompactProgressSetters = SpinnerSetter & {
	compactStallHintMs: number;
};

export function applyOnCompactProgress(
	event: CompactProgressEvent,
	setters: CompactProgressSetters,
): void {
	switch (event.type) {
		case "hooks_start":
			setters.setSpinnerColor("accentBlue_FOR_SYSTEM_SPINNER");
			setters.setSpinnerShimmerColor("accentBlueShimmer_FOR_SYSTEM_SPINNER");
			setters.setSpinnerMessage(
				event.hookType === "pre_compact"
					? "Running PreCompact hooks…"
					: event.hookType === "post_compact"
						? "Running PostCompact hooks…"
						: "Running SessionStart hooks…",
			);
			break;
		case "compact_start":
			setters.setSpinnerMessage("Compacting conversation");
			break;
		case "compact_retry":
			setters.setSpinnerMessage(
				`Compacting (retry ${event.attempt}/${event.maxRetries}: ${event.reason})`,
			);
			break;
		case "compact_stall":
			if (event.elapsedMs >= setters.compactStallHintMs) {
				setters.setSpinnerMessage(
					`Compacting conversation — running ${formatDuration(event.elapsedMs)}, large context summaries can take a while`,
				);
			}
			break;
		case "compact_end":
			setters.setSpinnerMessage(null);
			setters.setSpinnerColor(null);
			setters.setSpinnerShimmerColor(null);
			break;
	}
}
