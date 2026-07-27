/**
 * Attribution Hooks — 提交归因 hooks
 *
 * 注册 git 提交归因追踪 hooks，用于在代码生成时记录
 * AI 助手的贡献信息，包括模型名称、prompt 数量等。
 *
 * 这些 hooks 在 post-tool-use 阶段执行，收集 attribution 数据
 * 并在 git 提交时附加归因信息。
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
