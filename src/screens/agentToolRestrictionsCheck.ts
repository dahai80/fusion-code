// audit 1.1.1 slice #56: agent tool restrictions useMemo body extracted (PURE-ROUTING-SUB-BLOCK useMemo-body variant, like #27/#28/#35/#41-#55).
// REPL() applies agent tool restrictions when mainThreadAgentDefinition is set: resolveAgentTools(def, mergedTools, false, true) → { tools, allowedAgentTypes }.
// Original useMemo body. mainThreadAgentDefinition (deps trigger, state) + mergedTools (deps trigger, useMergedTools return) passed via ctx (closure capture), byte-equivalent behavior.
// The useMemo() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the memo body moves out (helper returns the computed object, REPL useMemo call passes it through).
// resolveAgentTools (tools/AgentTool/agentToolUtils) imported directly (not REPL state, per imported-helpers-directly rule; REPL also uses it at L975/L2447, keep the REPL import, helper imports directly too).
// Returns { tools: Tools; allowedAgentTypes: string | undefined } (literal structure matches the original useMemo body — only 2 fields, not all 5 of ResolvedAgentTools, byte-equivalent type inference).
// No JSX → .ts. deps [mainThreadAgentDefinition, mergedTools] unchanged.

import type { Tools } from "../Tool.js";
import { resolveAgentTools } from "../tools/AgentTool/agentToolUtils.js";
import type { AgentDefinition } from "../tools/AgentTool/loadAgentsDir.js";

type AgentToolRestrictionsCtx = {
	mainThreadAgentDefinition: AgentDefinition | undefined;
	mergedTools: Tools;
};

// REPL keeps the useMemo thin shell:
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
