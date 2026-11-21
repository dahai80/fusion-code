// audit 1.1.1: pure spinner state derivation extracted from REPL.tsx. No React, no side effects.
// Both derives only read their inputs and output string|null / boolean. REPL's useMemo is just a caching shell.

import type { HookProgress } from "../types/hooks.js";
import type { Message, ProgressMessage } from "../types/message.js";
import { count } from "./array.js";
import { isInternalBuild } from "./buildConstants.js";
import { truncateToWidth } from "./format.js";

const SLEEP_TOOL_NAME = "Sleep";

// In the showSpinner input, toolJSX only needs the showSpinner field; use a minimal shape to avoid pulling in React types.
type ToolJsxSpinnerLike = {
	showSpinner?: boolean;
} | null;

export type ShowSpinnerInput = {
	toolJSX: ToolJsxSpinnerLike;
	toolUseConfirmQueueLength: number;
	promptQueueLength: number;
	isLoading: boolean;
	userInputOnProcessing: string | undefined;
	hasRunningTeammates: boolean;
	commandQueueLength: number;
	pendingWorkerRequest: { toolName: string } | null;
	onlySleepToolActive: boolean;
	visibleStreamingText: string | null;
	isBriefOnly: boolean;
};

// Derive main spinner visibility. Byte-equivalent extraction of the original inline block at REPL.tsx:2034-2053.
// getCommandQueueLength has no side effects (only reads .length); REPL can pre-evaluate and pass it in.
export function deriveShowSpinner(input: ShowSpinnerInput): boolean {
	return (
		(!input.toolJSX || input.toolJSX.showSpinner === true) &&
		input.toolUseConfirmQueueLength === 0 &&
		input.promptQueueLength === 0 &&
		// While input is processing / an API call is in flight / a teammate is running / task
		// notifications are queued, keep the spinner visible
		// (avoids spinner flicker from isLoading momentarily being false between consecutive notifications)
		(input.isLoading ||
			input.userInputOnProcessing ||
			input.hasRunningTeammates ||
			input.commandQueueLength > 0) &&
		// Hide the spinner while waiting for the leader to approve a permission request
		!input.pendingWorkerRequest &&
		!input.onlySleepToolActive &&
		// Hide when streaming text is visible (the text is itself feedback), but keep it when isBriefOnly suppresses streaming display
		(!input.visibleStreamingText || input.isBriefOnly)
	);
}

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
