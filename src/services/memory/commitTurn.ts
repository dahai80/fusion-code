/**
 * Turn-level memory commit — when the query loop ends (stopHooks),
 * writes the just-completed user/assistant turn into fusion-memory long-term memory.
 *
 * Follows the extractMemories pattern: fire-and-forget, main agent only (not subagents);
 * on failure logs via logForDebugging and never throws, never blocks the main flow.
 *
 * session_id comes from getSessionId() (bootstrap/state), stable across sessions.
 * interaction.id uses randomUUID for idempotency (fm-server dedupes by id).
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

// Skip meta / virtual / compact-summary messages; record only real conversation
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

// Extract tool_use blocks from assistant content → ToolCall[]
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
 * Extract the last completed turn (the final user + its immediately following assistant) from the full message history.
 * Returns null when there is no submittable turn (empty history / a user with no assistant reply).
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
	// Find the first assistant after that user
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
 * Commit the last turn to long-term memory. fire-and-forget, never throws.
 *
 * @returns list of committed memory_ids (success) / null (skipped or failed)
 */
export async function commitLastTurn(
	ctx: CommitTurnContext,
): Promise<string[] | null> {
	// Main agent only, consistent with the extractMemories guard
	if (ctx.agentId) return null;
	const turn = extractLastTurn(ctx.messages);
	if (!turn) return null;
	// Empty conversation is not committed
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
