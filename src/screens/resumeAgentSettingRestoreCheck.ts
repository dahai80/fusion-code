// audit 1.1.1 slice #62: resume agent-setting restore sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #2)。
// resume() useCallback body 子块 (REPL L1949-1961): restoreAgentFromSession(log.agentSetting, initialMainThreadAgentDefinition, agentDefinitions)
// 返回 restoredAgent → setMainThreadAgentDefinition(restoredAgent) + setAppState(prev => ({...prev, agent: restoredAgent?.agentType}))。
// slice #61 兄弟模式: 小内聚子块从 resume useCallback 中切出, resume-local 变量 (log.agentSetting) 经 ctx 传入,
// REPL state (initialMainThreadAgentDefinition/agentDefinitions/setMainThreadAgentDefinition/setAppState) 亦经 ctx 传入, 行为字节等价。
// restoreAgentFromSession (utils/sessionRestore) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用 L396, 保留 REPL import)。
// 辅助返 restoredAgent (void 调用方不读返回, 但保留返回值以匹配原 destructuring 语义; REPL 薄壳不读返回)。
// 无 JSX → .ts。无 deps (resume body 内调用, 非 hook)。无 async/require/feature-flag (纯同步 setter 链)。
// 注: 此为 resume 多会话切块提取的第 2 块 (4 块中纯同步最少依赖)。后续 #63+ 提取 1876-1906/1963-1972/1980-2002。

import type { SetAppState } from "../Task.js";
import type {
	AgentDefinition,
	AgentDefinitionsResult,
} from "../tools/AgentTool/loadAgentsDir.js";
import { restoreAgentFromSession } from "../utils/sessionRestore.js";

type ResumeAgentSettingCtx = {
	agentSetting: string | undefined;
	initialMainThreadAgentDefinition: AgentDefinition | undefined;
	agentDefinitions: AgentDefinitionsResult;
	setMainThreadAgentDefinition: (def: AgentDefinition | undefined) => void;
	setAppState: SetAppState;
};

// REPL resume() 保留薄壳:
//   restoreResumeAgentSetting({
//     agentSetting: log.agentSetting,
//     initialMainThreadAgentDefinition,
//     agentDefinitions,
//     setMainThreadAgentDefinition,
//     setAppState,
//   });
export function restoreResumeAgentSetting(ctx: ResumeAgentSettingCtx): void {
	const { agentDefinition: restoredAgent } = restoreAgentFromSession(
		ctx.agentSetting,
		ctx.initialMainThreadAgentDefinition,
		ctx.agentDefinitions,
	);
	ctx.setMainThreadAgentDefinition(restoredAgent);
	ctx.setAppState((prev) => ({
		...prev,
		agent: restoredAgent?.agentType,
	}));
}
