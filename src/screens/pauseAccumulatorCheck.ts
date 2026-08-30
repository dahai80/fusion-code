// audit 1.1.1 slice #48: pause/resume 时序累加 useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#45/#47)。
// REPL() 在 loading 期间 focusedInputDialog 切到 "tool-permission" 即视为 pause: 立即记 pauseStartTime;
// 切回非 paused 且已有 pauseStartTime → 累加 totalPausedMs, 清 pauseStartTime。
// 目的: 不依赖 100ms 轮询, focusedInputDialog 变化即捕获, 高负载下时序仍准确。
// 原 useEffect body。focusedInputDialog + isLoading (derived deps) + pauseStartTimeRef + totalPausedMsRef (ref) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// 无模块 import (纯 ref + derived, 最简 slice)。无 JSX → .ts。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [focusedInputDialog, isLoading] 不变 (两个 ref 稳定引用, 省略合法, 与原一致)。

import type { MutableRefObject } from "react";
import type { FocusedDialogKind } from "../utils/focusedDialogSelector.js";

type PauseAccumulatorCheckCtx = {
	focusedInputDialog: FocusedDialogKind | undefined;
	isLoading: boolean;
	pauseStartTimeRef: MutableRefObject<number | null>;
	totalPausedMsRef: MutableRefObject<number>;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeAccumulatePauseTiming({ focusedInputDialog, isLoading, pauseStartTimeRef, totalPausedMsRef }), [focusedInputDialog, isLoading]);
export function maybeAccumulatePauseTiming(
	ctx: PauseAccumulatorCheckCtx,
): void {
	if (!ctx.isLoading) return;
	const isPaused = ctx.focusedInputDialog === "tool-permission";
	const now = Date.now();
	if (isPaused && ctx.pauseStartTimeRef.current === null) {
		// Just entered pause state - record the exact moment
		ctx.pauseStartTimeRef.current = now;
	} else if (!isPaused && ctx.pauseStartTimeRef.current !== null) {
		// Just exited pause state - accumulate paused time immediately
		ctx.totalPausedMsRef.current += now - ctx.pauseStartTimeRef.current;
		ctx.pauseStartTimeRef.current = null;
	}
}
