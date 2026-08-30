// audit 1.1.1 slice #45: deferred swarm-turn-duration useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#44)。
// REPL() 在所有 swarm teammates 结束后补发一次 turn-duration 消息: totalMs = Date.now() - swarmStartTimeRef.current。
// 原 useEffect body。hasRunningTeammates (derived dep) + swarmStartTimeRef/swarmBudgetInfoRef (ref) + setMessages 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// createTurnDurationMessage + isLoggableMessage (utils/messages.js) + count (utils/array.js) 直接 import (非 REPL state, per imported-helpers-directly rule; 全部 REPL 多用, 不移除 REPL import)。
// 无 JSX → .ts。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [hasRunningTeammates, setMessages] 不变 (两个 ref 稳定引用, 省略合法, 与原一致)。

import type { MutableRefObject, SetStateAction } from "react";
import type { Message as MessageType } from "../types/message.js";
import { count } from "../utils/array.js";
import { createTurnDurationMessage } from "../utils/messages.js";
import { isLoggableMessage } from "../utils/sessionStorage.js";

type SwarmBudgetInfo = {
	tokens: number;
	limit: number;
	nudges: number;
};

type SwarmTurnDurationCheckCtx = {
	hasRunningTeammates: boolean;
	swarmStartTimeRef: MutableRefObject<number | null>;
	swarmBudgetInfoRef: MutableRefObject<SwarmBudgetInfo | undefined>;
	setMessages: (action: SetStateAction<MessageType[]>) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeShowSwarmTurnDuration({ hasRunningTeammates, swarmStartTimeRef, swarmBudgetInfoRef, setMessages }), [hasRunningTeammates, setMessages]);
export function maybeShowSwarmTurnDuration(
	ctx: SwarmTurnDurationCheckCtx,
): void {
	if (ctx.hasRunningTeammates || ctx.swarmStartTimeRef.current === null) {
		return;
	}
	const totalMs = Date.now() - ctx.swarmStartTimeRef.current;
	const deferredBudget = ctx.swarmBudgetInfoRef.current;
	ctx.swarmStartTimeRef.current = null;
	ctx.swarmBudgetInfoRef.current = undefined;
	ctx.setMessages((prev) => [
		...prev,
		createTurnDurationMessage(
			totalMs,
			deferredBudget,
			// Count only what recordTranscript will persist — ephemeral
			// progress ticks and non-ant attachments are filtered by
			// isLoggableMessage and never reach disk. Using raw prev.length
			// would make checkResumeConsistency report false delta<0 for
			// every turn that ran a progress-emitting tool.
			count(prev, isLoggableMessage),
		),
	]);
}
