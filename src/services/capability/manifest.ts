// P5.5 能力清单 (Typert 类型图) — 纯导出函数 (enhance-0819.md §D.7 P5.5)。
//
// 从 fusion-code 工具/技能/插件定义生成类型图: 聚合 getAllBaseTools (tools.ts:169,
// sync) + getCommands (commands.ts:410, async memoize) + getBundledSkills
// (bundledSkills.ts:108, sync) + loadAllPlugins (pluginLoader.ts:3132, async)。
// schema 序列化复用 zodToJsonSchema (utils/zodToJsonSchema.ts:15) + MCP 工具
// inputJSONSchema 短路 (Tool.ts:411, 同 api.ts:158-160 模式)。
//
// 纯函数: 只读聚合, 不写盘/不发起网络/不 mutate 源。返回 JSON 可序列化对象。
// 默认 off (runtime.ts 门控); 此模块自身不做门控 — 调用方 (cli handler) 门控。

import { getAllBaseTools } from "../../tools.js";
import { getCommands } from "../../commands.js";
import { getBundledSkills } from "../../skills/bundledSkills.js";
import { loadAllPlugins } from "../../utils/plugins/pluginLoader.js";
import { zodToJsonSchema } from "../../utils/zodToJsonSchema.js";
import { logForDebugging } from "../../utils/debug.js";
import type { Tool } from "../../Tool.js";
import type { CapabilityManifestOptions } from "./runtime.js";

// 清单条目类型 (JSON 可序列化)。

export interface ManifestToolEntry {
	kind: "tool";
	name: string;
	aliases?: string[];
	searchHint?: string;
	enabled: boolean;
	readOnly?: boolean;
	isMcp?: boolean;
	shouldDefer?: boolean;
	alwaysLoad?: boolean;
	inputSchema?: Record<string, unknown>;
}

export interface ManifestCommandEntry {
	kind: "command";
	name: string;
	description: string;
	type?: string;
	source?: string;
	aliases?: string[];
	enabled?: boolean;
	isHidden?: boolean;
	whenToUse?: string;
	argumentHint?: string;
	contentLength?: number;
	allowedTools?: string[];
}

export interface ManifestPluginEntry {
	kind: "plugin";
	name: string;
	source: string;
	enabled?: boolean;
	isBuiltin?: boolean;
	version?: string;
	description?: string;
}

export type ManifestEntry =
	| ManifestToolEntry
	| ManifestCommandEntry
	| ManifestPluginEntry;

export interface CapabilityManifest {
	schemaVersion: 1;
	generatedAt: string;
	cwd: string;
	totals: {
		tools: number;
		commands: number;
		skills: number;
		plugins: number;
	};
	tools: ManifestToolEntry[];
	commands: ManifestCommandEntry[];
	skills: ManifestCommandEntry[];
	plugins: ManifestPluginEntry[];
}

// 导出单个工具 → 清单条目。只读静态字段 + schema (按选项)。
function toolToEntry(
	tool: Tool,
	includeSchemas: boolean,
): ManifestToolEntry {
	const entry: ManifestToolEntry = {
		kind: "tool",
		name: tool.name,
		enabled: tool.isEnabled(),
	};
	if (tool.aliases && tool.aliases.length > 0) entry.aliases = tool.aliases;
	if (tool.searchHint) entry.searchHint = tool.searchHint;
	if (tool.isMcp) entry.isMcp = true;
	if (tool.shouldDefer) entry.shouldDefer = true;
	if (tool.alwaysLoad) entry.alwaysLoad = true;
	if (includeSchemas) {
		// MCP 工具带原生 JSON Schema (inputJSONSchema), 直接用; 否则 zod 转 JSON Schema。
		// 同 api.ts:158-160 短路模式。
		if ("inputJSONSchema" in tool && tool.inputJSONSchema) {
			entry.inputSchema = tool.inputJSONSchema as Record<string, unknown>;
		} else {
			try {
				entry.inputSchema = zodToJsonSchema(tool.inputSchema);
			} catch (err) {
				logForDebugging(
					`[capability] schema convert failed for tool "${tool.name}": ${(err as Error).message}`,
				);
			}
		}
	}
	return entry;
}

// 导出单个 Command → 清单条目。区分技能 (prompt + source=bundled/skills) 与命令。
function commandToEntry(
	cmd: Awaited<ReturnType<typeof getCommands>>[number],
): ManifestCommandEntry {
	const entry: ManifestCommandEntry = {
		kind: "command",
		name: cmd.name,
		description: cmd.description,
	};
	if ("type" in cmd && cmd.type) entry.type = cmd.type;
	if ("source" in cmd && cmd.source) entry.source = cmd.source;
	if (cmd.aliases && cmd.aliases.length > 0) entry.aliases = cmd.aliases;
	if (typeof cmd.isEnabled === "function") entry.enabled = cmd.isEnabled();
	if (cmd.isHidden) entry.isHidden = cmd.isHidden;
	if (cmd.whenToUse) entry.whenToUse = cmd.whenToUse;
	if (cmd.argumentHint) entry.argumentHint = cmd.argumentHint;
	// contentLength 仅 PromptCommand 有 (command.ts:29)。
	if ("contentLength" in cmd && typeof cmd.contentLength === "number") {
		entry.contentLength = cmd.contentLength;
	}
	if ("allowedTools" in cmd && Array.isArray(cmd.allowedTools)) {
		entry.allowedTools = cmd.allowedTools;
	}
	return entry;
}

// 导出单个 LoadedPlugin → 清单条目。
function pluginToEntry(
	plugin: Awaited<ReturnType<typeof loadAllPlugins>>["enabled"][number],
): ManifestPluginEntry {
	const entry: ManifestPluginEntry = {
		kind: "plugin",
		name: plugin.name,
		source: plugin.source,
	};
	if (plugin.enabled !== undefined) entry.enabled = plugin.enabled;
	if (plugin.isBuiltin) entry.isBuiltin = true;
	if (plugin.manifest?.version) entry.version = plugin.manifest.version;
	if (plugin.manifest?.description) entry.description = plugin.manifest.description;
	return entry;
}

// 主聚合: 纯函数 (async 仅因 getCommands/loadAllPlugins 异步)。
export async function exportCapabilityManifest(
	options: CapabilityManifestOptions,
): Promise<CapabilityManifest> {
	const includeSkills = options.includeSkills !== false;
	const includePlugins = options.includePlugins !== false;
	const includeSchemas = options.includeSchemas !== false;

	const tools = getAllBaseTools().map((t) => toolToEntry(t, includeSchemas));

	const allCommands = includeSkills ? await getCommands(options.cwd) : [];
	const bundledSkillNames = new Set(
		getBundledSkills().map((s) => s.name),
	);
	// 技能 = prompt 类型命令 (bundled/skills 源); 其余归 commands。
	const skills: ManifestCommandEntry[] = [];
	const commands: ManifestCommandEntry[] = [];
	for (const cmd of allCommands) {
		const entry = commandToEntry(cmd);
		const isSkill =
			entry.type === "prompt" &&
			(entry.source === "bundled" ||
				entry.source === "skills" ||
				bundledSkillNames.has(cmd.name));
		if (isSkill) skills.push(entry);
		else commands.push(entry);
	}

	let plugins: ManifestPluginEntry[] = [];
	if (includePlugins) {
		try {
			const loaded = await loadAllPlugins();
			plugins = [
				...loaded.enabled.map(pluginToEntry),
				...loaded.disabled.map(pluginToEntry),
			];
		} catch (err) {
			logForDebugging(
				`[capability] loadAllPlugins failed: ${(err as Error).message}`,
			);
		}
	}

	const manifest: CapabilityManifest = {
		schemaVersion: 1,
		generatedAt: options.generatedAt ?? "",
		cwd: options.cwd,
		totals: {
			tools: tools.length,
			commands: commands.length,
			skills: skills.length,
			plugins: plugins.length,
		},
		tools,
		commands,
		skills,
		plugins,
	};
	logForDebugging(
		`[capability] manifest exported: tools=${tools.length} commands=${commands.length} skills=${skills.length} plugins=${plugins.length}`,
	);
	return manifest;
}
