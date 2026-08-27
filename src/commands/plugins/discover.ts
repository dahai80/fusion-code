// discover.ts — /plugins discover [query] [--source=...] (ar-plan PR #5, E1).
// Fetches the official registry.json index (registryIndex.ts), lists installable
// plugins, filters by an optional query + source, and marks builtin plugins.
// Install is not wired here (the existing heavy install path lives in
// pluginInstallationHelpers); discover surfaces the name + source so the user
// runs the existing install command. Byte-identical when not invoked.
import chalk from "chalk";
import type { RegistryEntry, RegistryIndex } from "../../utils/plugins/registryIndex.js";
import { fetchRegistryIndex, isOffline } from "../../utils/plugins/registryIndex.js";
import { logForDebugging } from "../../utils/debug.js";

export interface DiscoverOpts {
	query: string;
	source: "all" | "official" | "community" | "git" | "archive";
}

// Parse `discover foo --source=official` → { query: "foo", source: "official" }.
// Bare flags (--source official) also accepted. Unknown source → "all".
export function parseDiscoverArgs(argStr: string): DiscoverOpts {
	let source: DiscoverOpts["source"] = "all";
	const tokens = argStr.split(/\s+/).filter(Boolean);
	const queryTokens: string[] = [];
	for (const tok of tokens) {
		const eqMatch = /^--source=(.+)$/i.exec(tok);
		if (eqMatch) {
			source = normalizeSource(eqMatch[1]);
			continue;
		}
		if (tok.toLowerCase() === "--source") {
			continue;
		}
		if (
			queryTokens.length === 0 &&
			(tok === "official" || tok === "community" || tok === "git" || tok === "archive") &&
			tokens.some((t) => t.toLowerCase() === "--source")
		) {
			// `--source official` form — value token right after the flag.
			source = normalizeSource(tok);
			continue;
		}
		queryTokens.push(tok);
	}
	return { query: queryTokens.join(" "), source };
}

function normalizeSource(raw: string): DiscoverOpts["source"] {
	const lower = raw.toLowerCase();
	if (lower === "official" || lower === "community" || lower === "git" || lower === "archive") {
		return lower;
	}
	return "all";
}

function entryMatchesSource(entry: RegistryEntry, source: DiscoverOpts["source"]): boolean {
	if (source === "all") return true;
	if (source === "official") return entry.category === "official" || entry.builtin === true;
	if (source === "community") return entry.category === "community";
	// git/archive → match the per-entry install source type.
	return entry.source?.type === source;
}

function entryMatchesQuery(entry: RegistryEntry, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return (
		entry.name.toLowerCase().includes(q) ||
		(entry.description?.toLowerCase().includes(q) ?? false) ||
		(entry.category?.toLowerCase().includes(q) ?? false)
	);
}

export async function discoverPlugins(opts: DiscoverOpts): Promise<{ type: "text"; value: string }> {
	const index: RegistryIndex = await fetchRegistryIndex();
	const filtered = index.plugins.filter(
		(e) => entryMatchesSource(e, opts.source) && entryMatchesQuery(e, opts.query),
	);
	logForDebugging(
		`[plugins] discover query="${opts.query}" source=${opts.source} → ${filtered.length}/${index.plugins.length}`,
	);

	if (index.plugins.length === 0) {
		const note = isOffline()
			? "Offline mode (FUSION_OFFLINE=1): no cached registry. Local builtin plugins still available via /plugins list."
			: "Registry index is empty or unreachable. Check FUSION_CODE_PLUGIN_REGISTRY_URL or network.";
		return { type: "text", value: chalk.dim(note) };
	}

	const lines: string[] = [
		chalk.bold(`Discovered plugins (${filtered.length}${opts.query || opts.source !== "all" ? ` filtered` : ""}):`),
	];
	for (const entry of filtered) {
		const tag = entry.builtin
			? chalk.yellow(" [builtin]")
			: entry.category === "official"
				? chalk.green(" [official]")
				: entry.category === "community"
					? chalk.blue(" [community]")
					: "";
		const version = entry.version ? chalk.dim(` v${entry.version}`) : "";
		const desc = entry.description ? chalk.dim(` — ${entry.description}`) : "";
		lines.push(`  ${chalk.cyan(entry.name)}${version}${tag}${desc}`);
	}
	lines.push("");
	lines.push(chalk.dim("Install with the existing install command using the source shown. Use /plugins list to see installed."));
	return { type: "text", value: lines.join("\n") };
}
