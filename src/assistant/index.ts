/**
 * KAIROS Assistant — multi-session assistant system
 *
 * Provides Assistant Mode, allowing multiple sessions to run in parallel,
 * with team member collaboration, task assignment, and session management.
 *
 * Main features:
 * - Assistant mode activation/deactivation
 * - Assistant team initialization
 * - System prompt extension
 * - Session history management
 *
 * gated by feature('KAIROS')
 */

import { feature } from "bun:bundle";
import { getGlobalConfig } from "../utils/config.js";
import { logForDebugging } from "../utils/debug.js";
import { isEnvTruthy } from "../utils/envUtils.js";

let _assistantForced = false;
let _assistantMode = false;
let _activationPath: string | undefined;

export interface AssistantTeamContext {
	sessionId: string;
	teamSize: number;
	createdAt: number;
}

// isKairosEnabled() wrapper removed: feature() from bun:bundle can only sit
// directly in an if/ternary (DCE constraint), not as a return value. Inlined
// at the two call sites below.

/**
 * Check if assistant mode is currently active.
 */
export function isAssistantMode(): boolean {
	if (!feature("KAIROS")) return false;
	return (
		_assistantMode ||
		_assistantForced ||
		isEnvTruthy(process.env.FUSION_CODE_ASSISTANT_MODE)
	);
}

/**
 * Mark assistant mode as forced (by --assistant flag).
 */
export function markAssistantForced(): void {
	_assistantForced = true;
	_assistantMode = true;
	logForDebugging("[KAIROS] Assistant mode forced via --assistant flag");
}

/**
 * Initialize the assistant team.
 * Creates the team context and spawns worker processes if needed.
 */
export async function initializeAssistantTeam(): Promise<AssistantTeamContext> {
	_assistantMode = true;
	_activationPath = "startup";

	const context: AssistantTeamContext = {
		sessionId: `kairos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		teamSize: 1,
		createdAt: Date.now(),
	};

	logForDebugging(`[KAIROS] Assistant team initialized: ${context.sessionId}`);
	return context;
}

/**
 * Get the assistant system prompt addendum.
 * Appended to the system prompt when assistant mode is active.
 */
export function getAssistantSystemPromptAddendum(): string {
	if (!isAssistantMode()) return "";

	return `
# Assistant Mode

You are running in assistant mode. You can:
- Manage multiple concurrent sessions
- Delegate tasks to team members
- Monitor progress across sessions
- Coordinate work between different contexts

Use the Agent tool to delegate tasks. Each agent operates in its own session.
You will receive notifications when delegated tasks complete.
`;
}

/**
 * Get the assistant activation path (for telemetry/analytics).
 */
export function getAssistantActivationPath(): string | undefined {
	return _activationPath;
}

/**
 * Set the assistant activation path.
 */
export function setAssistantActivationPath(path: string): void {
	_activationPath = path;
}

/**
 * Check if the assistant chat is pending (from CLI args).
 */
export function isAssistantChatPending(): boolean {
	if (!feature("KAIROS")) return false;
	const config = getGlobalConfig();
	return !!(config as Record<string, unknown>).assistantChatPending;
}

/**
 * Get the pending assistant chat session ID.
 */
export function getPendingAssistantSessionId(): string | undefined {
	if (!isAssistantChatPending()) return undefined;
	const config = getGlobalConfig() as Record<string, unknown>;
	return (config.assistantChatSessionId as string) || undefined;
}
