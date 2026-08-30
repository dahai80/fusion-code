// audit 1.1.1 slice #54: idle-notification useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#53)。
// REPL() mount-ish useEffect: 响应结束 + 用户 idle → 定时检查后发 idle_prompt 通知 (maybeSendIdleNotification, slice #30 内层回调已移出)。
// 原 useEffect body: 3 guards (isLoading/submitCount===0/lastQueryCompletionTime===0) → setTimeout(getGlobalConfig().messageIdleNotifThresholdMs, 5 stale-closure-bypass args) → return () => clearTimeout(timer)。
// isLoading + submitCount + lastQueryCompletionTime + toolJSX + focusedInputDialogRef + terminal (deps 触发器) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出; helper 返 cleanup fn 或 undefined (guards 早返则 undefined, 与原 useEffect return 语义一致)。
// maybeSendIdleNotification (utils/idleNotification, slice #30 内层) + getGlobalConfig (utils/config) 直接 import (非 REPL state, per imported-helpers-directly rule; maybeSendIdleNotification REPL 单用提取后 REPL import 移除; getGlobalConfig REPL 多用保留 REPL import, helper 亦直接 import)。
// ctx 5 字段类型从 maybeSendIdleNotification 参数派生 (其 ToolJSX/IdleNotificationCtx 未 export, 用 Parameters<typeof> 避免重复定义), + submitCount (guard only)。
// 无 JSX → .ts。返 (() => void) | undefined (REPL 薄壳 useEffect 透传)。
// deps [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal] 不变 (focusedInputDialogRef ref 稳定引用, 省略合法, 与原一致)。

import { getGlobalConfig } from "../utils/config.js";
import type { maybeSendIdleNotification } from "../utils/idleNotification.js";
import { maybeSendIdleNotification as maybeSendIdleNotificationFn } from "../utils/idleNotification.js";

type IdleNotificationCtx = Parameters<typeof maybeSendIdleNotification>[0];

type IdleNotificationEffectCtx = {
	submitCount: number;
} & IdleNotificationCtx;

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeScheduleIdleNotification({ isLoading, submitCount, lastQueryCompletionTime, toolJSX, focusedInputDialogRef, terminal }), [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal]);
export function maybeScheduleIdleNotification(
	ctx: IdleNotificationEffectCtx,
): (() => void) | undefined {
	// Don't set up notification if Claude is busy
	if (ctx.isLoading) return;

	// Only enable notifications after the first new interaction in this session
	if (ctx.submitCount === 0) return;

	// No query has completed yet
	if (ctx.lastQueryCompletionTime === 0) return;

	// Set timeout to check idle state
	const timer = setTimeout(
		(
			lastQueryCompletionTime,
			isLoading,
			toolJSX,
			focusedInputDialogRef,
			terminal,
		) => {
			// audit 1.1.1: idle-notification 回调体 → maybeSendIdleNotification (PURE-ROUTING SUB-BLOCK)。
			// 5 个 setTimeout-arg 参数作 ctx 传入 (绕 stale closure), 行为字节等价。
			maybeSendIdleNotificationFn({
				lastQueryCompletionTime,
				isLoading,
				toolJSX,
				focusedInputDialogRef,
				terminal,
			});
		},
		getGlobalConfig().messageIdleNotifThresholdMs,
		ctx.lastQueryCompletionTime,
		ctx.isLoading,
		ctx.toolJSX,
		ctx.focusedInputDialogRef,
		ctx.terminal,
	);
	return () => clearTimeout(timer);
}
