// audit 1.1.1 slice #68: resume SessionEnd+SessionStart hooks sub-block extracted (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #8).
// resume() useCallback body sub-block (REPL L1891-1914, 24 LOC): first fires SessionEnd hooks for the current session (mirror /clear flow in conversation.ts),
// then processSessionStartHooks(source, {sessionId, agentType, model}) yields hookMessages, pushed into the conversation.
// Fork sessions report source "fork" (CC 2.1.214, issue #79), letting the hook distinguish fork from plain resume.
// slice #61-#67 sibling pattern: a resume useCallback sub-block cut out; resume-local variables (entrypoint, sessionId, messages) +
// REPL state (store, setAppState, mainThreadAgentDefinition, mainLoopModel) passed via ctx, byte-equivalent behavior.
// return-value-threading (#63 pattern): hookMessages → messages.push(...hookMessages) — the messages array is passed via ctx, the helper pushes directly (not via return).
// executeSessionEndHooks/processSessionStartHooks/getSessionEndHookTimeoutMs (hooks.ts + sessionStart.ts import block) imported directly
// (not REPL state, per imported-helpers-directly rule; executeSessionEndHooks/processSessionStartHooks used multiple times in REPL, REPL import kept).
// Helper returns Promise<void> (two awaits + push, async). No JSX → .ts.
// Note: this is chunk #8 of the resume chunked extraction (sessionEnd + sessionStart hooks, includes return-value-threading).

import type { UUID } from "node:crypto";
import type { ResumeEntrypoint } from "../commands.js";
import type { AppStateStore } from "../state/AppStateStore.js";
import type { AgentDefinition } from "../tools/AgentTool/loadAgentsDir.js";
import type {
	HookResultMessage,
	Message as MessageType,
} from "../types/message.js";
import {
	executeSessionEndHooks,
	getSessionEndHookTimeoutMs,
} from "../utils/hooks.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import type { ModelName } from "../utils/model/model.js";
import { processSessionStartHooks } from "../utils/sessionStart.js";

type ResumeSessionHooksCtx = {
	entrypoint: ResumeEntrypoint;
	sessionId: UUID;
	messages: MessageType[];
	store: AppStateStore;
	setAppState: SetAppState;
	mainThreadAgentDefinition?: AgentDefinition;
	mainLoopModel: ModelName;
};

export async function runResumeSessionHooks(
	ctx: ResumeSessionHooksCtx,
): Promise<void> {
	const sessionEndTimeoutMs = getSessionEndHookTimeoutMs();
	await executeSessionEndHooks("resume", {
		getAppState: () => ctx.store.getState(),
		setAppState: ctx.setAppState,
		signal: AbortSignal.timeout(sessionEndTimeoutMs),
		timeoutMs: sessionEndTimeoutMs,
	});

	const sessionStartSource = ctx.entrypoint === "fork" ? "fork" : "resume";
	const hookMessages: HookResultMessage[] = await processSessionStartHooks(
		sessionStartSource,
		{
			sessionId: ctx.sessionId,
			agentType: ctx.mainThreadAgentDefinition?.agentType,
			model: ctx.mainLoopModel,
		},
	);

	ctx.messages.push(...hookMessages);
}
