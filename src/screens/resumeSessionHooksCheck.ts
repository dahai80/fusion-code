// audit 1.1.1 slice #68: resume SessionEnd+SessionStart hooks sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #8)。
// resume() useCallback body 子块 (REPL L1891-1914, 24-LOC): 先为当前会话 fire SessionEnd hooks (mirror /clear flow in conversation.ts),
// 再 processSessionStartHooks(source, {sessionId, agentType, model}) 取 hookMessages, push 进 conversation。
// Fork 会话报告 source "fork" (CC 2.1.214, issue #79), 让 hook 区分 fork 与普通 resume。
// slice #61-#67 兄弟模式: resume useCallback 子块切出, resume-local 变量 (entrypoint, sessionId, messages) +
// REPL state (store, setAppState, mainThreadAgentDefinition, mainLoopModel) 经 ctx 传入, 行为字节等价。
// return-value-threading (#63 模式): hookMessages → messages.push(...hookMessages) — messages 数组经 ctx 传入, helper 直接 push (非 return)。
// executeSessionEndHooks/processSessionStartHooks/getSessionEndHookTimeoutMs (hooks.ts + sessionStart.ts import 块) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 多用 executeSessionEndHooks/processSessionStartHooks, 保留 REPL import)。
// 辅助返 Promise<void> (两 await + push, 异步)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 8 块 (sessionEnd + sessionStart hooks, 含 return-value-threading)。

import type { UUID } from "crypto";
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
