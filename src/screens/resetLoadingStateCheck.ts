// audit 1.1.1 slice #55: resetLoadingState useCallback body 外移 (INLINE-CALLBACK curried-factory, like #46/#49/#50/#53)。
// REPL() turn 结束重置 loading/streaming/spinner 状态: external loading off + user-processing clear +
// response/metrics ref 清零 + streaming text/toolUses 清空 + spinner 清空 + 新 tip + 结束 interaction span + 清 speculative checks。
// 原 useCallback body。setIsExternalLoading (useCallback 包装) + setUserInputOnProcessing (useCallback 包装) +
// responseLengthRef/apiMetricsRef (useRef 对象, 稳定引用) + setStreamingText/setStreamingToolUses/setSpinnerMessage/
// setSpinnerColor/setSpinnerShimmerColor (useState setters) + pickNewSpinnerTip (REPL-local useCallback) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useCallback() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 callback body 移出 (curried factory 返 fn, REPL useCallback 再包一层透传)。
// endInteractionSpan (utils/telemetry/sessionTracing) + clearSpeculativeChecks (tools/BashTool/bashPermissions) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 单用, 提取后 REPL import 移除)。
// ctx 类型: setIsExternalLoading/setUserInputOnProcessing 为 useCallback 包装 (非 useState 原始 setter), 用其精确签名
// (value: boolean)/(input: string|undefined), 非 Dispatch<SetStateAction> (#53 lesson: 从 useCallback decl 窄化, 非 loose string)。
// responseLengthRef: MutableRefObject<number>; apiMetricsRef: MutableRefObject<Array<{...}>> (元素 shape 复制, ref 对象稳定引用)。
// 无 JSX → .ts。返 () => void (REPL 薄壳 useCallback 透传)。
// deps [pickNewSpinnerTip] 不变 (其余 setter/ref 稳定引用, pickNewSpinnerTip 为 REPL-local useCallback dep)。

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

// REPL 保留 useCallback 薄壳:
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
