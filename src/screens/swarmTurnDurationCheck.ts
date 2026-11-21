// audit 1.1.1 slice #45: deferred swarm-turn-duration useEffect body extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#44).
// REPL() posts the turn-duration message once after all swarm teammates finish: totalMs = Date.now() - swarmStartTimeRef.current.
// Original useEffect body. hasRunningTeammates (derived dep) + swarmStartTimeRef/swarmBudgetInfoRef (refs) + setMessages passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// createTurnDurationMessage + isLoggableMessage (utils/messages.js) + count (utils/array.js) imported directly (not REPL state, per imported-helpers-directly rule; all used multiple times in REPL, REPL imports not removed).
// No JSX → .ts. Returns void (REPL thin-shell useEffect pass-through, no cleanup).
// deps [hasRunningTeammates, setMessages] unchanged (both refs are stable, safe to omit, matching the original).

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

// REPL keeps the useEffect thin shell:
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
