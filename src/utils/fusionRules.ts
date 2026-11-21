/**
 * FUSION.rules runtime — denied tools registry and config extraction.
 *
 * FUSION.rules frontmatter fields:
 * - denied_tools: string[] — tool names that are blocked for this project
 * - default_template: string — workflow template to auto-assign to new sessions
 *
 * Priority: global rules > project FUSION.rules > session temporary rules
 */

import { logForDebugging } from "./debug.js";

export type FusionRulesConfig = {
	deniedTools: string[];
	defaultTemplate: string | null;
};

let mergedConfig: FusionRulesConfig = {
	deniedTools: [],
	defaultTemplate: null,
};

export function parseFusionRulesFrontmatter(
	frontmatter: Record<string, unknown>,
): FusionRulesConfig {
	const deniedTools = Array.isArray(frontmatter.denied_tools)
		? (frontmatter.denied_tools as string[]).filter(
				(t) => typeof t === "string",
			)
		: [];
	const defaultTemplate =
		typeof frontmatter.default_template === "string"
			? frontmatter.default_template
			: null;
	return { deniedTools, defaultTemplate };
}

export function setFusionRulesConfig(config: FusionRulesConfig): void {
	mergedConfig = config;
	logForDebugging(
		`fusionRules: config updated, deniedTools=[${config.deniedTools.join(",")}], defaultTemplate=${config.defaultTemplate}`,
	);
}

export function getFusionRulesConfig(): FusionRulesConfig {
	return mergedConfig;
}

// P1-28: denied_tools is name-deny, not capability-deny.
// ["Bash"] blocks the builtin Bash, but not MCP tools (mcp__foo__run_bash), plugin tools, or
// plugin slash commands shelled out (hooks.ts shell:true spawn does not pass through this gate). Users must understand this is
// a name-list deny — blocking the "run arbitrary shell" capability requires additionally configuring MCP/plugin server-level deny or sandbox.
// Not expanded to capability-tag deny (tags assigned at registration) to stay surgical: list semantics are clear, docs make it explicit.
export function isToolDenied(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	return mergedConfig.deniedTools.some((t) => t.toLowerCase() === lower);
}

// P2-12: isToolDenied only checks the primary name, not aliases. If a user lists an old name/alias in denied_tools (e.g.
// TaskStop, the old name of KillShell) -> the model calls the primary name TaskStop -> isToolDenied("TaskStop") false
// -> deny silently fails. This helper checks primary name + all aliases; call sites pass the Tool object to match.
export function isToolDeniedByNameOrAlias(tool: {
	name: string;
	aliases?: string[];
}): boolean {
	if (isToolDenied(tool.name)) return true;
	if (tool.aliases?.length) {
		return tool.aliases.some((alias) => isToolDenied(alias));
	}
	return false;
}

export function getDeniedTools(): string[] {
	return [...mergedConfig.deniedTools];
}

export function getDefaultTemplate(): string | null {
	return mergedConfig.defaultTemplate;
}

export function mergeFusionRulesConfigs(
	configs: FusionRulesConfig[],
): FusionRulesConfig {
	const merged: FusionRulesConfig = {
		deniedTools: [],
		defaultTemplate: null,
	};
	for (const config of configs) {
		// deniedTools takes the union (harmless, more layers = stricter).
		merged.deniedTools = [
			...new Set([...merged.deniedTools, ...config.deniedTools]),
		];
		// P2-13: defaultTemplate switched to first-wins (earliest occurrence wins).
		// configs order = [global, project, ...] (claudemd assembles in descending priority order).
		// The original last-wins let project override global, opposite to the CLAUDE.md doc priority
		// (global highest). first-wins makes global win, aligning with the docs.
		if (config.defaultTemplate && !merged.defaultTemplate) {
			merged.defaultTemplate = config.defaultTemplate;
		}
	}
	return merged;
}
