// audit 1.1.1 slice #39: streamingThinking auto-hide useEffect body 外移 (full-useEffect-body-returns-timer-handle variant, 3rd — 像 slice #34 maybeScheduleIdleReturnHint / #35 maybeScheduleSafeYoloMessage)。
// REPL() streaming thinking 完成后 30s 自动隐藏: 完成(isStreaming=false + streamingEndedAt 存在) → 按 elapsed 算 remaining → remaining>0 起 setTimeout(setStreamingThinking, remaining, null) 返 cleanup, 否则立即清。
// 原 useEffect body。streamingThinking + setStreamingThinking 经 ctx 传入 (闭包捕获), 行为字节等价。
// StreamingThinking (messages.js) 直接 import (非 REPL state, per imported-helpers-directly rule)。
// 无 JSX/无 hook → .ts。返 (() => void) | undefined (REPL 薄壳 useEffect 透传 cleanup)。

import type { StreamingThinking } from "../utils/messages.js";

type StreamingThinkingClearCtx = {
	streamingThinking: StreamingThinking | null;
	setStreamingThinking: (v: StreamingThinking | null) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeClearStreamingThinking({ streamingThinking, setStreamingThinking }), [streamingThinking]);
// deps [streamingThinking] 不变 (setStreamingThinking 是 useState setter, 稳定引用, 省略合法, 与原一致)。
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
