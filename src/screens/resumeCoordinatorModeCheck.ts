// audit 1.1.1 slice #63: resume COORDINATOR_MODE match+agent-defs refresh sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #3)。
// resume() useCallback body 子块 (REPL L1879-1908, 30-LOC): feature("COORDINATOR_MODE") 守卫内 —
// require("../coordinator/coordinatorMode.js").matchSessionMode(log.mode) 返 warning →
// 若 warning: require("../tools/AgentTool/loadAgentsDir.js").getAgentDefinitionsWithOverrides.cache.clear?.() +
// await getAgentDefinitionsWithOverrides(getOriginalCwd()) 重派生 agent defs →
// setAppState(prev => ({...prev, agentDefinitions: {...freshAgentDefs, allAgents, activeAgents: getActiveAgentsFromList}})) +
// messages.push(createSystemMessage(warning, "warn")) 追加警告消息。
// slice #61/#62 兄弟模式: 大 useCallback 子块切出, resume-local 变量 (log.mode, messages) 经 ctx 传入,
// feature-gate + require() 动态导入 + await 全部移入 helper, REPL 薄壳只剩一次调用。行为字节等价。
// feature (bun:bundle) + getOriginalCwd (bootstrap/state) + createSystemMessage (utils/messages) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import)。
// require() 动态导入 (coordinatorModule/loadAgentsDir) 保留在 helper 内 (原 require 写法, feature-gated 死代码消除)。
// 辅助返 Promise<void> (内含 await, REPL 薄壳 await 调用)。无 JSX → .ts。
// 注: 此为 resume 多会话切块提取的第 3 块 (含 async/require/feature-flag, 依赖最多)。后续 #64 提取 1980-2002 cost+session-switch。

import { feature } from "bun:bundle";
import { getOriginalCwd } from "../bootstrap/state.js";
import type { SetAppState } from "../Task.js";
import type { Message as MessageType } from "../types/message.js";
import { createSystemMessage } from "../utils/messages.js";

type ResumeCoordinatorModeCtx = {
	mode: "coordinator" | "normal" | undefined;
	messages: MessageType[];
	setAppState: SetAppState;
};

// REPL resume() 保留薄壳:
//   await matchResumeCoordinatorMode({
//     mode: log.mode,
//     messages,
//     setAppState,
//   });
export async function matchResumeCoordinatorMode(
	ctx: ResumeCoordinatorModeCtx,
): Promise<void> {
	if (!feature("COORDINATOR_MODE")) {
		return;
	}
	/* eslint-disable @typescript-eslint/no-require-imports */
	const coordinatorModule =
		require("../coordinator/coordinatorMode.js") as typeof import("../coordinator/coordinatorMode.js");
	/* eslint-enable @typescript-eslint/no-require-imports */
	const warning = coordinatorModule.matchSessionMode(ctx.mode);
	if (warning) {
		// Re-derive agent definitions after mode switch so built-in agents
		// reflect the new coordinator/normal mode
		/* eslint-disable @typescript-eslint/no-require-imports */
		const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
			require("../tools/AgentTool/loadAgentsDir.js") as typeof import("../tools/AgentTool/loadAgentsDir.js");
		/* eslint-enable @typescript-eslint/no-require-imports */
		getAgentDefinitionsWithOverrides.cache.clear?.();
		const freshAgentDefs = await getAgentDefinitionsWithOverrides(
			getOriginalCwd(),
		);
		ctx.setAppState((prev) => ({
			...prev,
			agentDefinitions: {
				...freshAgentDefs,
				allAgents: freshAgentDefs.allAgents,
				activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
			},
		}));
		ctx.messages.push(createSystemMessage(warning, "warn"));
	}
}
