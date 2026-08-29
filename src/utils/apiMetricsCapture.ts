// audit 1.1.1: 从 REPL.tsx onQueryImpl apiMetrics capture 子块抽出 (PURE-ROUTING SUB-BLOCK class, 像 slice #19 onCompactProgress)。
// 行为等价 REPL.tsx:3300-3337。无 React hooks, 无 JSX, 无 await。
// 仅 isInternalBuild() 且 apiMetricsRef 有 entries 时:
//   (1) 计算 per-request OTPS (streaming-only content / active streaming time);
//   (2) multi-request 用 median (P50), single 用 [0];
//   (3) 采集 hook/tool/classifier duration+count + turnMs + configWriteCount;
//   (4) setMessages 追加 createApiMetricsMessage。
// ctx 携带 REPL 闭包依赖 (apiMetricsRef + loadingStartTimeRef + setMessages),
//   helper 不持有 React state。timing fn / median / isInternalBuild / createApiMetricsMessage / getGlobalConfigWriteCount 为独立 module import。
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

// REPL 保留薄调用: captureApiMetrics({ apiMetricsRef, loadingStartTimeRef, setMessages });
// 包在原 `if (isInternalBuild() && apiMetricsRef.current.length > 0)` 外层判断里 (helper 内部再判一次, 双保险)。
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
