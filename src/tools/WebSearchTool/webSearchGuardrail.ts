import { logForDebugging } from "../../utils/debug.js";

// WebSearch per-session guardrail (CC 2.1.217 item 13 alignment, enhance-0819.md
// §优先级矩阵). Caps cumulative WebSearchTool invocations per session so a
// runaway agent cannot burn unbounded web searches. Env defaults match CC A.2.1.
//
// Count semantics: one WebSearchTool.call() = one invocation counted. A single
// call may issue up to `max_uses: 8` server-side searches, but the cap is on
// call invocations (simple, gate runs before the call when the inner search
// count is unknown). 200/session far exceeds normal usage (<20); exceeding it
// signals a runaway agent, same intent as the subagent caps (PR #82).
//
// State: AppState.webSearchCount, incremented by WebSearchTool.call after the
// gate passes, reset to 0 by /clear (clearConversation).

export const DEFAULT_MAX_WEB_SEARCHES_PER_SESSION = 200;

// Parse a positive-integer env cap. Falls back to `defaultValue` when unset,
// empty, non-numeric, or <= 0 (guard against a misconfigured 0/negative cap
// that would block ALL searches — fail open, not silent).
function parseCap(envValue: string | undefined, defaultValue: number): number {
	if (envValue === undefined || envValue === "") return defaultValue;
	const parsed = Number.parseInt(envValue, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		logForDebugging(
			`[webSearchGuardrail] invalid cap env "${envValue}", falling back to ${defaultValue}`,
		);
		return defaultValue;
	}
	return parsed;
}

export function getMaxWebSearchesPerSession(): number {
	return parseCap(
		process.env.FUSION_MAX_WEB_SEARCHES_PER_SESSION,
		DEFAULT_MAX_WEB_SEARCHES_PER_SESSION,
	);
}

export type WebSearchGuardrailInput = {
	// Session-cumulative search count (AppState.webSearchCount), tracked +
	// reset-on-/clear by WebSearchTool.call + clearConversation.
	sessionSearchCount: number;
};

// Returns a human-readable rejection reason, or null if the cap passes.
export function checkWebSearchGuardrail(
	input: WebSearchGuardrailInput,
): string | null {
	const { sessionSearchCount } = input;
	const maxPerSession = getMaxWebSearchesPerSession();
	if (sessionSearchCount >= maxPerSession) {
		return `Web search rejected: ${sessionSearchCount} web search(es) performed this session, at the session limit of ${maxPerSession} (FUSION_MAX_WEB_SEARCHES_PER_SESSION). Start a new session with /clear to reset the count, or raise the limit.`;
	}
	return null;
}
