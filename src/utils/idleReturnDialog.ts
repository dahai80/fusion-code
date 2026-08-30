// audit 1.1.1: 从 REPL.tsx onSubmit idle-return gate 块抽出 (PURE-ROUTING SUB-BLOCK class, 像 slice #25/#26)。
// 行为等价 REPL.tsx:3865-3900 (block-scope {})。无 React hooks, 无 JSX, 无 await。
// idle-return: 长对话 + 冷 cache 时引导 returning 用户开新会话。tengu_willow_mode 控制: "dialog"(阻塞)/"hint"/"off"。
// 仅当 willowMode!=="off" && !idleReturnDismissed && !skipIdleCheckRef && !speculationAccept
//   && 非 slash-command && lastQueryCompletionTime>0 && totalTokens>=tokenThreshold:
//   idleMinutes = (now - lastQueryCompletionTime)/60000;
//   若 idleMinutes >= idleThresholdMin && willowMode==="dialog" →
//     setIdleReturnPending({input, idleMinutes}) + setInputValue("") + helpers.setCursorOffset(0) + helpers.clearBuffer() + return true (早退信号)。
// 返回 boolean: true=已触发 dialog 早退 (REPL return), false=不触发 (REPL 继续)。
// ctx 携带 REPL 闭包依赖 (skipIdleCheckRef + lastQueryCompletionTimeRef + speculationAccept + setIdleReturnPending + setInputValue + helpers),
//   input 为 onSubmit 参数。getFeatureValue_CACHED_MAY_BE_STALE/getGlobalConfig/getTotalInputTokens 为独立 module import。
import { getTotalInputTokens } from "../bootstrap/state.js";
import { getFeatureValue_CACHED_MAY_BE_STALE } from "../services/analytics/growthbook.js";
import type { ActiveSpeculationState } from "../services/PromptSuggestion/index.js";
import { getGlobalConfig } from "./config.js";
import type { PromptInputHelpers } from "./handlePromptSubmit.js";
import type { SetAppState } from "./messageQueueManager.js";

type IdleReturnCtx = {
	skipIdleCheckRef: { current: boolean };
	lastQueryCompletionTimeRef: { current: number };
	speculationAccept?: {
		state: ActiveSpeculationState;
		speculationSessionTimeSavedMs: number;
		setAppState: SetAppState;
	};
	setIdleReturnPending: (val: { input: string; idleMinutes: number }) => void;
	setInputValue: (val: string) => void;
	helpers: PromptInputHelpers;
};

// REPL 保留薄调用:
//   if (maybeTriggerIdleReturnDialog(input, { skipIdleCheckRef, lastQueryCompletionTimeRef, speculationAccept, setIdleReturnPending, setInputValue, helpers })) return;
export function maybeTriggerIdleReturnDialog(
	input: string,
	ctx: IdleReturnCtx,
): boolean {
	const willowMode = getFeatureValue_CACHED_MAY_BE_STALE(
		"tengu_willow_mode",
		"off",
	);
	const idleThresholdMin = Number(
		process.env.CLAUDE_CODE_IDLE_THRESHOLD_MINUTES ?? 75,
	);
	const tokenThreshold = Number(
		process.env.CLAUDE_CODE_IDLE_TOKEN_THRESHOLD ?? 100_000,
	);
	if (
		willowMode !== "off" &&
		!getGlobalConfig().idleReturnDismissed &&
		!ctx.skipIdleCheckRef.current &&
		!ctx.speculationAccept &&
		!input.trim().startsWith("/") &&
		ctx.lastQueryCompletionTimeRef.current > 0 &&
		getTotalInputTokens() >= tokenThreshold
	) {
		const idleMs = Date.now() - ctx.lastQueryCompletionTimeRef.current;
		const idleMinutes = idleMs / 60_000;
		if (idleMinutes >= idleThresholdMin && willowMode === "dialog") {
			ctx.setIdleReturnPending({
				input,
				idleMinutes,
			});
			ctx.setInputValue("");
			ctx.helpers.setCursorOffset(0);
			ctx.helpers.clearBuffer();
			return true;
		}
	}
	return false;
}
