/**
 * Turn-start memory retrieve — when the query loop starts (processUserInput),
 * recalls relevant context from fusion-memory long-term memory and injects it into this turn's conversation.
 *
 * Symmetric with commitTurn: commit writes at turn end, retrieve recalls at turn start.
 * Follows the extractMemories pattern: main agent only (not subagents); on failure logs
 * via logForDebugging, never throws, never blocks the main flow.
 *
 * Retrieved results are formatted by formatContextToPrompt into a <fusion_memory_context> section,
 * injected by the caller as an attachment message (the same path as the UserPromptSubmit hook's
 * additionalContext).
 *
 * env (operator):
 *   FUSION_MEMORY_API_KEY unset → retrieveContext skips internally and returns null
 *   FUSION_MEMORY_RETRIEVE_TOP_K (default 10) / FUSION_MEMORY_RETRIEVE_BUDGET (default 4096)
 */

import { logForDebugging } from "src/utils/debug.js";
import {
	formatContextToPrompt,
	retrieveContext,
} from "./fusionMemoryClient.js";

function getRetrieveTopK(): number {
	const raw = process.env.FUSION_MEMORY_RETRIEVE_TOP_K;
	const parsed = raw ? Number.parseInt(raw, 10) : 10;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function getRetrieveBudget(): number {
	const raw = process.env.FUSION_MEMORY_RETRIEVE_BUDGET;
	const parsed = raw ? Number.parseInt(raw, 10) : 4096;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

export interface RetrieveMemoryContext {
	inputText: string;
	agentId?: string;
}

/**
 * Recall long-term memories relevant to this turn's user input; returns an injectable <fusion_memory_context> section.
 * An empty string means skip (main-agent guard unmet / no input / retrieval failure / no hits).
 * Never throws.
 *
 * @returns memory section string (injected only when non-empty) / "" (skip)
 */
export async function retrieveMemorySection(
	ctx: RetrieveMemoryContext,
): Promise<string> {
	// Main agent only, consistent with the commitLastTurn guard
	if (ctx.agentId) return "";
	const query = ctx.inputText?.trim();
	if (!query) return "";

	try {
		const formatted = await retrieveContext(
			query,
			getRetrieveTopK(),
			getRetrieveBudget(),
		);
		const section = formatContextToPrompt(formatted);
		if (section) {
			const n = formatted?.blocks?.length ?? 0;
			logForDebugging(
				`[Fusion-Memory] retrieved ${n} memory block(s) for turn-start inject`,
			);
		}
		return section;
	} catch (error) {
		logForDebugging(
			`[Fusion-Memory] retrieveMemorySection error: ${(error as Error).message}`,
		);
		return "";
	}
}
