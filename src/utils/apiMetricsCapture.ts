// audit 1.1.1: apiMetrics capture sub-block extracted from REPL.tsx onQueryImpl (PURE-ROUTING SUB-BLOCK class, like slice #19 onCompactProgress).
// Behavior-equivalent to REPL.tsx:3300-3337. No React hooks, no JSX, no await.
// Only when isInternalBuild() and apiMetricsRef has entries:
//   (1) compute per-request OTPS (streaming-only content / active streaming time);
//   (2) multi-request uses median (P50), single uses [0];
//   (3) collect hook/tool/classifier duration+count + turnMs + configWriteCount;
//   (4) setMessages appends createApiMetricsMessage.
// ctx carries REPL closure deps (apiMetricsRef + loadingStartTimeRef + setMessages);
//   the helper holds no React state. timing fn / median / isInternalBuild / createApiMetricsMessage / getGlobalConfigWriteCount are standalone module imports.
import {
	getTurnClassifierCount,
	getTurnClassifierDurationMs,
	getTurnHookCount,
	getTurnHookDurationMs,
	getTurnToolCount,
	getTurnToolDurationMs,
} from "../bootstrap/state.js";
import type { Message as MessageType } from "../types/message.js";
import { median } from "./array.js";
import { isInternalBuild } from "./buildConstants.js";
import { getGlobalConfigWriteCount } from "./config.js";
import { createApiMetricsMessage } from "./messages.js";

export type ApiMetricsEntry = {
	ttftMs: number;
	firstTokenTime: number;
	lastTokenTime: number;
	responseLengthBaseline: number;
	endResponseLength: number;
};

type ApiMetricsCaptureCtx = {
	apiMetricsRef: { current: ApiMetricsEntry[] };
	loadingStartTimeRef: { current: number };
	setMessages: (action: React.SetStateAction<MessageType[]>) => void;
};

// REPL keeps a thin call: captureApiMetrics({ apiMetricsRef, loadingStartTimeRef, setMessages });
// wrapped in the original `if (isInternalBuild() && apiMetricsRef.current.length > 0)` outer check (the helper re-checks internally, double insurance).
export function captureApiMetrics(ctx: ApiMetricsCaptureCtx): void {
	if (!isInternalBuild() || ctx.apiMetricsRef.current.length === 0) return;
	const entries = ctx.apiMetricsRef.current;
	const ttfts = entries.map((e) => e.ttftMs);
	// Compute per-request OTPS using only active streaming time and
	// streaming-only content. endResponseLength tracks content added by
	// streaming deltas only, excluding subagent/compaction inflation.
	const otpsValues = entries.map((e) => {
		const delta = Math.round(
			(e.endResponseLength - e.responseLengthBaseline) / 4,
		);
		const samplingMs = e.lastTokenTime - e.firstTokenTime;
		return samplingMs > 0 ? Math.round(delta / (samplingMs / 1000)) : 0;
	});
	const isMultiRequest = entries.length > 1;
	const hookMs = getTurnHookDurationMs();
	const hookCount = getTurnHookCount();
	const toolMs = getTurnToolDurationMs();
	const toolCount = getTurnToolCount();
	const classifierMs = getTurnClassifierDurationMs();
	const classifierCount = getTurnClassifierCount();
	const turnMs = Date.now() - ctx.loadingStartTimeRef.current;
	ctx.setMessages((prev) => [
		...prev,
		createApiMetricsMessage({
			// biome-ignore lint/style/noNonNullAssertion: entries.length>0 guarded at fn entry
			ttftMs: isMultiRequest ? median(ttfts) : ttfts[0]!,
			// biome-ignore lint/style/noNonNullAssertion: entries.length>0 guarded at fn entry
			otps: isMultiRequest ? median(otpsValues) : otpsValues[0]!,
			isP50: isMultiRequest,
			hookDurationMs: hookMs > 0 ? hookMs : undefined,
			hookCount: hookCount > 0 ? hookCount : undefined,
			turnDurationMs: turnMs > 0 ? turnMs : undefined,
			toolDurationMs: toolMs > 0 ? toolMs : undefined,
			toolCount: toolCount > 0 ? toolCount : undefined,
			classifierDurationMs: classifierMs > 0 ? classifierMs : undefined,
			classifierCount: classifierCount > 0 ? classifierCount : undefined,
			configWriteCount: getGlobalConfigWriteCount(),
		}),
	]);
}
