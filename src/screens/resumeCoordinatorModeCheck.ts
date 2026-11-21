// audit 1.1.1 slice #63: resume COORDINATOR_MODE match+agent-defs refresh sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #3).
// resume() useCallback body sub-block (REPL L1879-1908, 30 LOC): inside the feature("COORDINATOR_MODE") guard —
// require("../coordinator/coordinatorMode.js").matchSessionMode(log.mode) returns warning →
// if warning: require("../tools/AgentTool/loadAgentsDir.js").getAgentDefinitionsWithOverrides.cache.clear?.() +
// await getAgentDefinitionsWithOverrides(getOriginalCwd()) re-derives agent defs →
// setAppState(prev => ({...prev, agentDefinitions: {...freshAgentDefs, allAgents, activeAgents: getActiveAgentsFromList}})) +
// messages.push(createSystemMessage(warning, "warn")) appends the warning message.
// slice #61/#62 sibling pattern: a large useCallback sub-block cut out; resume-local variables (log.mode, messages) passed via ctx,
// feature-gate + require() dynamic imports + await all moved into the helper; the REPL thin shell is a single call. Byte-equivalent behavior.
// feature (bun:bundle) + getOriginalCwd (bootstrap/state) + createSystemMessage (utils/messages) imported directly
// (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept).
// require() dynamic imports (coordinatorModule/loadAgentsDir) stay inside the helper (original require style, feature-gated dead-code elimination).
// Helper returns Promise<void> (contains await, the REPL thin shell awaits the call). No JSX → .ts.
// Note: this is chunk #3 of the resume multi-session chunked extraction (contains async/require/feature-flag, most dependencies). #64 later extracts 1980-2002 cost+session-switch.

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

// REPL keeps the resume() thin shell:
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
