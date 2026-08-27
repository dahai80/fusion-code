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

// P1-28: denied_tools 是按名拒绝 (name-deny), 非按能力拒绝 (capability-deny)。
// 配 ["Bash"] 阻内置 Bash, 但不阻 MCP 工具 (mcp__foo__run_bash)、插件工具、或
// shell 出的插件 slash 命令 (hooks.ts shell:true spawn 不经此门)。用户须明白此为
// 名单拒绝 — 想阻"执行任意 shell"能力须额外配 MCP/插件 server 级 deny 或沙箱。
// 不扩成能力 tag 拒绝 (注册时打 tag) 以保持 surgical: 名单语义清晰, 文档明确即可。
export function isToolDenied(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	return mergedConfig.deniedTools.some((t) => t.toLowerCase() === lower);
}

// P2-12: isToolDenied 只查主名, 不查别名。用户在 denied_tools 列旧名/别名 (如
// KillShell 旧名 TaskStop) → 模型调主名 TaskStop → isToolDenied("TaskStop") false
// → deny 静默失效。此 helper 查主名 + 全别名, 调用点传 Tool 对象匹配。
export function isToolDeniedByNameOrAlias(
	tool: { name: string; aliases?: string[] },
): boolean {
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
		// deniedTools 取并集 (无害, 多层叠加更严)。
		merged.deniedTools = [
			...new Set([...merged.deniedTools, ...config.deniedTools]),
		];
		// P2-13: defaultTemplate 改 first-wins (最早出现的优先)。
		// configs 顺序 = [global, project, ...] (claudemd 组装按优先级降序)。
		// 原 last-wins 让 project 覆盖 global, 与 CLAUDE.md 文档优先级
		// (global 最高) 相反。first-wins 使 global 优先, 对齐文档。
		if (config.defaultTemplate && !merged.defaultTemplate) {
			merged.defaultTemplate = config.defaultTemplate;
		}
	}
	return merged;
}
