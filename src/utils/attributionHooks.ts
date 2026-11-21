/**
 * Attribution Hooks — commit attribution hooks
 *
 * Registers git commit attribution tracking hooks, used to record
 * the AI assistant's contribution info during code generation,
 * including model name, prompt count, etc.
 *
 * These hooks run at the post-tool-use stage, collecting attribution data
 * and attaching attribution info to git commits.
 *
 * gated by feature('COMMIT_ATTRIBUTION')
 */

import { logForDebugging } from "./debug.js";

/**
 * Register attribution tracking hooks.
 * Called during setup to register attribution hooks for post-tool-use tracking.
 */
export function registerAttributionHooks(): void {
	logForDebugging("[Attribution] Registering attribution hooks");
	// In the full implementation, this registers callback hooks for:
	// - post_tool_use: track attribution data for each tool use
	// - post_query: accumulate attribution data across turns
	// The hooks are registered with the hook system to fire after each tool execution.
}

/**
 * Track attribution data for a tool use.
 * Records the model, prompt count, and other metadata for attribution.
 */
export function trackAttribution(_data: {
	model: string;
	promptCount: number;
	toolName: string;
}): void {
	// Attribution tracking implementation
	// In the full implementation, this stores attribution data
	// that gets attached to git commits via post-commit hooks.
	logForDebugging(
		`[Attribution] Tracking: ${_data.toolName} (${_data.model}, prompt #${_data.promptCount})`,
	);
}

/**
 * Get attribution summary for the current session.
 * Returns a summary string describing the AI contributions.
 */
export function getAttributionSummary(): string {
	return "Generated with AI assistance";
}

// log: fix TS2339
export function clearAttributionCaches(): void {
	logForDebugging("[Attribution] Clearing attribution caches");
}

export function sweepFileContentCache(): void {
	logForDebugging("[Attribution] Sweeping file content cache");
	clearAttributionCaches();
}
