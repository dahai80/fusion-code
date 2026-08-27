/**
 * Turn-level memory commit — 在 query loop 结束 (stopHooks) 时
 * 把刚完成的 user/assistant turn 写入 fusion-memory 长期记忆。
 *
 * 仿 extractMemories 模式: fire-and-forget, 仅主 agent (非 subagent),
 * 失败 logForDebugging 不抛, 不阻断主流程。
 *
 * session_id 取自 getSessionId() (bootstrap/state), 跨 session 稳定。
 * interaction.id 用 randomUUID 保证幂等性 (fm-server 按 id 去重)。
 */

import { randomUUID } from "node:crypto";
import { getSessionId } from "src/bootstrap/state.js";
import type {
	AssistantMessage,
	Message,
	UserMessage,
} from "src/types/message.js";
import { logForDebugging } from "src/utils/debug.js";
import { getContentText } from "src/utils/messages.js";
import {
	commitEpisodicMemory,
	type Interaction,
	type ToolCall,
	type Turn,
} from "./fusionMemoryClient.js";

// 跳过 meta / virtual / compact-summary 消息, 只记真实对话
function isRealUserMessage(m: Message): m is UserMessage {
	return (
		m.type === "user" &&
		!m.isMeta &&
		!m.isVirtual &&
		!m.isCompactSummary &&
		!m.isVisibleInTranscriptOnly
	);
}

function isRealAssistantMessage(m: Message): m is AssistantMessage {
	return m.type === "assistant" && !m.isMeta && !m.isApiErrorMessage;
}

// 从 assistant content 提取 tool_use 块 → ToolCall[]
function extractToolCalls(msg: AssistantMessage): ToolCall[] {
	const calls: ToolCall[] = [];
	for (const block of msg.message.content) {
		if (block.type === "tool_use") {
			calls.push({
				name: block.name,
				args: block.input,
				result_summary: "",
			});
		}
	}
	return calls;
}

/**
 * 从完整消息历史提取最后完成的 turn (最后一个 user + 紧随的 assistant)。
 * 返回 null 表示没有可提交的 turn (历史为空 / 只有 user 没有 assistant)。
 */
function extractLastTurn(messages: Message[]): Turn | null {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isRealUserMessage(messages[i])) {
			lastUserIdx = i;
			break;
		}
	}
	if (lastUserIdx < 0) return null;
	// 找该 user 之后第一个 assistant
	for (let i = lastUserIdx + 1; i < messages.length; i++) {
		if (isRealAssistantMessage(messages[i])) {
			const userMsg = messages[lastUserIdx] as UserMessage;
			const asstMsg = messages[i] as AssistantMessage;
			return {
				turn_idx: 0,
				user_message: getContentText(userMsg.message.content) ?? "",
				assistant_message: getContentText(asstMsg.message.content) ?? "",
				tool_calls: extractToolCalls(asstMsg),
			};
		}
	}
	return null;
}

export interface CommitTurnContext {
	messages: Message[];
	agentId?: string;
}

/**
 * 提交最后一个 turn 到长期记忆。fire-and-forget, 不抛。
 *
 * @returns 提交的 memory_id 列表 (成功) / null (跳过或失败)
 */
export async function commitLastTurn(
	ctx: CommitTurnContext,
): Promise<string[] | null> {
	// 仅主 agent, 与 extractMemories 守卫一致
	if (ctx.agentId) return null;
	const turn = extractLastTurn(ctx.messages);
	if (!turn) return null;
	// 空对话不提交
	if (!turn.user_message && !turn.assistant_message) return null;

	const interaction: Interaction = {
		id: randomUUID(),
		session_id: getSessionId(),
		turns: [turn],
		timestamp: Date.now(),
		metadata: { source: "fusion-code" },
	};

	try {
		const ids = await commitEpisodicMemory(interaction.session_id, interaction);
		if (ids) {
			logForDebugging(
				`[Fusion-Memory] committed turn → ${ids.length} memory id(s)`,
			);
		}
		return ids;
	} catch (error) {
		logForDebugging(
			`[Fusion-Memory] commitLastTurn error: ${(error as Error).message}`,
		);
		return null;
	}
}
