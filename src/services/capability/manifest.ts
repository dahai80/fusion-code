// P5.5 capability manifest (Typert type graph) — pure exported functions (enhance-0819.md §D.7 P5.5).
//
// Builds a type graph from fusion-code tool/skill/plugin definitions: aggregates
// getAllBaseTools (tools.ts:169, sync) + getCommands (commands.ts:410, async memoize)
// + getBundledSkills (bundledSkills.ts:108, sync) + loadAllPlugins (pluginLoader.ts:3132,
// async). Schema serialization reuses zodToJsonSchema (utils/zodToJsonSchema.ts:15) plus
// the MCP tool inputJSONSchema short-circuit (Tool.ts:411, same pattern as api.ts:158-160).
//
// Pure function: read-only aggregation; no disk writes, no network calls, no source
// mutation. Returns a JSON-serializable object.
// Off by default (gated in runtime.ts); this module does not gate itself — the caller
// (cli handler) gates.

import { getCommands } from "../../commands.js";
import { getBundledSkills } from "../../skills/bundledSkills.js";
import type { Tool } from "../../Tool.js";
import { getAllBaseTools } from "../../tools.js";
import { logForDebugging } from "../../utils/debug.js";
import { loadAllPlugins } from "../../utils/plugins/pluginLoader.js";
import { zodToJsonSchema } from "../../utils/zodToJsonSchema.js";
import type { CapabilityManifestOptions } from "./runtime.js";

// Manifest entry types (JSON-serializable).

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

// Export a single tool → manifest entry. Read-only static fields + schema (per options).
function toolToEntry(tool: Tool, includeSchemas: boolean): ManifestToolEntry {
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
		// MCP tools carry native JSON Schema (inputJSONSchema) — use it directly; otherwise convert zod to JSON Schema.
		// Same short-circuit pattern as api.ts:158-160.
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

// Export a single Command → manifest entry. Distinguish skills (prompt + source=bundled/skills) from commands.
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
	// contentLength only exists on PromptCommand (command.ts:29).
	if ("contentLength" in cmd && typeof cmd.contentLength === "number") {
		entry.contentLength = cmd.contentLength;
	}
	if ("allowedTools" in cmd && Array.isArray(cmd.allowedTools)) {
		entry.allowedTools = cmd.allowedTools;
	}
	return entry;
}

// Export a single LoadedPlugin → manifest entry.
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
	if (plugin.manifest?.description)
		entry.description = plugin.manifest.description;
	return entry;
}

// Main aggregation: pure function (async only because getCommands/loadAllPlugins are async).
export async function exportCapabilityManifest(
	options: CapabilityManifestOptions,
): Promise<CapabilityManifest> {
	const includeSkills = options.includeSkills !== false;
	const includePlugins = options.includePlugins !== false;
	const includeSchemas = options.includeSchemas !== false;

	const tools = getAllBaseTools().map((t) => toolToEntry(t, includeSchemas));

	const allCommands = includeSkills ? await getCommands(options.cwd) : [];
	const bundledSkillNames = new Set(getBundledSkills().map((s) => s.name));
	// Skills = prompt-type commands (bundled/skills source); the rest are counted as commands.
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
