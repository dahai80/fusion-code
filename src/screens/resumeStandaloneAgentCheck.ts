// audit 1.1.1 slice #71: resume standalone agent context sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume chunked-extraction #11)。
// resume() useCallback body 子块 (REPL L1916-1926, 11-LOC): setAppState(prev => ({...prev,
// standaloneAgentContext: computeStandaloneAgentContext(log.agentName, log.agentColor)}))
// [从 resumed conversation 恢复 standalone agent context, 总是 reset 到新会话值或清空] +
// void updateSessionName(log.agentName) [持久化会话名到 pid file]。
// slice #61-#70 兄弟模式: resume useCallback 子块切出, resume-local 变量 (log) + REPL state (setAppState) 经 ctx 传入, 行为字节等价。
// computeStandaloneAgentContext (sessionRestore import) + updateSessionName (concurrentSessions import) 直接 import
// (非 REPL state, per imported-helpers-directly rule; 两者 REPL sole-user → 此 slice 后 REPL import 移除)。
// 辅助返 void (setAppState void + void fire-and-forget updateSessionName)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 11 块 (standalone agent context restore)。

import type { LogOption } from "../types/logs.js";
import { updateSessionName } from "../utils/concurrentSessions.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import { computeStandaloneAgentContext } from "../utils/sessionRestore.js";

type ResumeStandaloneAgentCtx = {
	log: LogOption;
	setAppState: SetAppState;
};

export function restoreResumeStandaloneAgent(
	ctx: ResumeStandaloneAgentCtx,
): void {
	ctx.setAppState((prev) => ({
		...prev,
		standaloneAgentContext: computeStandaloneAgentContext(
			ctx.log.agentName,
			ctx.log.agentColor,
		),
	}));
	void updateSessionName(ctx.log.agentName);
}
