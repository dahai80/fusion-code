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

export function isToolDenied(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	return mergedConfig.deniedTools.some((t) => t.toLowerCase() === lower);
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
		merged.deniedTools = [
			...new Set([...merged.deniedTools, ...config.deniedTools]),
		];
		if (config.defaultTemplate) {
			merged.defaultTemplate = config.defaultTemplate;
		}
	}
	return merged;
}
