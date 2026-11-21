// audit 1.1.1 slice #62: resume agent-setting restore sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #2).
// resume() useCallback body sub-block (REPL L1949-1961): restoreAgentFromSession(log.agentSetting, initialMainThreadAgentDefinition, agentDefinitions)
// returns restoredAgent → setMainThreadAgentDefinition(restoredAgent) + setAppState(prev => ({...prev, agent: restoredAgent?.agentType})).
// slice #61 sibling pattern: a small cohesive sub-block cut out of the resume useCallback; resume-local variables (log.agentSetting) passed via ctx,
// REPL state (initialMainThreadAgentDefinition/agentDefinitions/setMainThreadAgentDefinition/setAppState) also passed via ctx, byte-equivalent behavior.
// restoreAgentFromSession (utils/sessionRestore) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL at L396, REPL import kept).
// Helper returns restoredAgent (the void caller doesn't read the return, but it is kept to match the original destructuring semantics; the REPL thin shell ignores the return).
// No JSX → .ts. No deps (called inside the resume body, not a hook). No async/require/feature-flag (pure synchronous setter chain).
// Note: this is chunk #2 of the resume multi-session chunked extraction (the least-dependent purely-synchronous one of the 4). #63+ later extract 1876-1906/1963-1972/1980-2002.

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

// REPL keeps the resume() thin shell:
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
