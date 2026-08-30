// audit 1.1.1 slice #56: agent tool restrictions useMemo body 外移 (PURE-ROUTING-SUB-BLOCK useMemo-body variant, like #27/#28/#35/#41-#55)。
// REPL() mainThreadAgentDefinition 设置时应用 agent tool 限制: resolveAgentTools(def, mergedTools, false, true) → { tools, allowedAgentTypes }。
// 原 useMemo body。mainThreadAgentDefinition (deps 触发器, state) + mergedTools (deps 触发器, useMergedTools 返回) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useMemo() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 memo body 移出 (helper 返计算对象, REPL useMemo 调用透传)。
// resolveAgentTools (tools/AgentTool/agentToolUtils) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用 L975/L2447, 保留 REPL import, helper 亦直接 import)。
// 返 { tools: Tools; allowedAgentTypes: string | undefined } (与原 useMemo body 字面结构一致 — 仅 2 字段, 非 ResolvedAgentTools 全 5 字段, 字节等价类型推导)。
// 无 JSX → .ts。deps [mainThreadAgentDefinition, mergedTools] 不变。

import type { Tools } from "../Tool.js";
import { resolveAgentTools } from "../tools/AgentTool/agentToolUtils.js";
import type { AgentDefinition } from "../tools/AgentTool/loadAgentsDir.js";

type AgentToolRestrictionsCtx = {
	mainThreadAgentDefinition: AgentDefinition | undefined;
	mergedTools: Tools;
};

// REPL 保留 useMemo 薄壳:
//   const { tools, allowedAgentTypes } = useMemo(
//     () => resolveAgentToolsRestrictions({ mainThreadAgentDefinition, mergedTools }),
//     [mainThreadAgentDefinition, mergedTools],
//   );
export function resolveAgentToolsRestrictions(ctx: AgentToolRestrictionsCtx): {
	tools: Tools;
	allowedAgentTypes: string[] | undefined;
} {
	if (!ctx.mainThreadAgentDefinition) {
		return {
			tools: ctx.mergedTools,
			allowedAgentTypes: undefined as string[] | undefined,
		};
	}
	const resolved = resolveAgentTools(
		ctx.mainThreadAgentDefinition,
		ctx.mergedTools,
		false,
		true,
	);
	return {
		tools: resolved.resolvedTools,
		allowedAgentTypes: resolved.allowedAgentTypes,
	};
}
