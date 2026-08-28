// audit 1.1.1: 从 REPL.tsx 抽出的纯 spinner 状态推导。无 React, 无副作用。
// 两段 derive 都只读入参, 输出 string|null / boolean。REPL 的 useMemo 仅作缓存壳。

import type { Message, ProgressMessage } from "../types/message.js";
import type { HookProgress } from "../types/hooks.js";
import { count } from "./array.js";
import { isInternalBuild } from "./buildConstants.js";
import { truncateToWidth } from "./format.js";

const SLEEP_TOOL_NAME = "Sleep";

// Hide spinner when the only in-progress tool is Sleep
export function onlySleepToolActive(
	messages: readonly Message[],
	inProgressToolUseIDs: ReadonlySet<string>,
): boolean {
	const lastAssistant = messages.findLast((m) => m.type === "assistant");
	if (lastAssistant?.type !== "assistant") return false;
	const inProgressToolUses = lastAssistant.message.content.filter(
		(b) => b.type === "tool_use" && inProgressToolUseIDs.has(b.id),
	);
	return (
		inProgressToolUses.length > 0 &&
		inProgressToolUses.every(
			(b) => b.type === "tool_use" && b.name === SLEEP_TOOL_NAME,
		)
	);
}

// Derive stop hook spinner suffix from messages state. null = no suffix.
export function stopHookSpinnerSuffix(
	messages: readonly Message[],
	isLoading: boolean,
): string | null {
	if (!isLoading) return null;

	// Find stop hook progress messages
	const progressMsgs = messages.filter(
		(m): m is ProgressMessage<HookProgress> =>
			m.type === "progress" &&
			m.data.type === "hook_progress" &&
			(m.data.hookEvent === "Stop" || m.data.hookEvent === "SubagentStop"),
	);
	if (progressMsgs.length === 0) return null;

	// Get the most recent stop hook execution
	const currentToolUseID = progressMsgs.at(-1)?.toolUseID;
	if (!currentToolUseID) return null;

	// Check if there's already a summary message for this execution (hooks completed)
	const hasSummaryForCurrentExecution = messages.some(
		(m) =>
			m.type === "system" &&
			m.subtype === "stop_hook_summary" &&
			m.toolUseID === currentToolUseID,
	);
	if (hasSummaryForCurrentExecution) return null;
	const currentHooks = progressMsgs.filter(
		(p) => p.toolUseID === currentToolUseID,
	);
	const total = currentHooks.length;

	// Count completed hooks
	const completedCount = count(messages, (m) => {
		if (m.type !== "attachment") return false;
		const attachment = m.attachment;
		return (
			"hookEvent" in attachment &&
			(attachment.hookEvent === "Stop" ||
				attachment.hookEvent === "SubagentStop") &&
			"toolUseID" in attachment &&
			attachment.toolUseID === currentToolUseID
		);
	});

	// Check if any hook has a custom status message
	const customMessage = currentHooks.find((p) => p.data.statusMessage)?.data
		.statusMessage;
	if (customMessage) {
		// Use custom message with progress counter if multiple hooks
		return total === 1
			? `${customMessage}…`
			: `${customMessage}… ${completedCount}/${total}`;
	}

	// Fall back to default behavior
	const hookType =
		currentHooks[0]?.data.hookEvent === "SubagentStop"
			? "subagent stop"
			: "stop";
	if (isInternalBuild()) {
		const cmd = currentHooks[completedCount]?.data.command;
		const label = cmd ? ` '${truncateToWidth(cmd, 40)}'` : "";
		return total === 1
			? `running ${hookType} hook${label}`
			: `running ${hookType} hook${label}… ${completedCount}/${total}`;
	}
	return total === 1
		? `running ${hookType} hook`
		: `running stop hooks… ${completedCount}/${total}`;
}
