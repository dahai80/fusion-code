// registryIndex.ts — official registry.json fetch + cache (ar-plan PR #5, E1).
// /plugins discover pulls a curated plugin index (name/version/source/sha256/
// description/category) from a registry URL, caches it under
// ~/.fusion-code/marketplace-cache/ with a 1h TTL, and returns the entries.
// Pure index fetch — no telemetry sent back (privacy). FUSION_OFFLINE=1 skips
// the fetch and returns the cached index (or empty if none), so local builtin
// plugins stay usable offline. Byte-identical when no one calls discover.
import axios from "axios";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getClaudeConfigHomeDir, isEnvTruthy } from "../envUtils.js";
import { logForDebugging } from "../debug.js";

// One entry per installable plugin in the official registry. `source` is the
// per-plugin install source — reuses the existing 4-type PluginSourceSchema
// shape (git/github/archive), resolved at install time by the existing loader.
// Kept loose (z.unknown() for the per-entry source) here so this module does
// not import the full PluginSourceSchema graph (avoids a cycle through
// pluginLoader). The loader re-validates the source on install anyway.
export const RegistryEntrySchema = z.object({
	name: z.string().min(1),
	version: z.string().optional(),
	description: z.string().optional(),
	category: z
		.enum(["official", "community", "integration", "model", "other"])
		.optional(),
	source: z.object({
		type: z.enum(["git", "github", "archive", "directory"]),
		url: z.string().optional(),
		repo: z.string().optional(),
		ref: z.string().optional(),
		path: z.string().optional(),
	}).passthrough(),
	sha256: z.string().optional(),
	builtin: z.boolean().optional(),
});

export const RegistryIndexSchema = z.object({
	schemaVersion: z.number().int().default(0),
	updated: z.string().optional(),
	plugins: z.array(RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type RegistryIndex = z.infer<typeof RegistryIndexSchema>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

// Resolved lazily (not at module load) so the cache dir can be overridden
// per-suite (tests point FUSION_CODE_REGISTRY_CACHE_DIR at a tmp dir; production
// leaves it unset → ~/.fusion-code/marketplace-cache). Byte-identical off:
// these never run unless discover fetches.
function cacheDir(): string {
	return (
		process.env.FUSION_CODE_REGISTRY_CACHE_DIR ??
		join(getClaudeConfigHomeDir(), "marketplace-cache")
	);
}
function cacheFile(): string {
	return join(cacheDir(), "registry.json");
}

// Default official registry. Overridable via FUSION_CODE_PLUGIN_REGISTRY_URL
// so tests + staging can point elsewhere without code changes.
export function defaultRegistryUrl(): string {
	return (
		process.env.FUSION_CODE_PLUGIN_REGISTRY_URL ??
		"https://raw.githubusercontent.com/dahai80/fusion-plugins-official/main/registry.json"
	);
}

export function isOffline(): boolean {
	return isEnvTruthy(process.env.FUSION_OFFLINE);
}

async function readCache(): Promise<RegistryIndex | null> {
	try {
		const raw = await readFile(cacheFile(), "utf8");
		const parsed = RegistryIndexSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			logForDebugging(`[registry] cache parse failed: ${parsed.error.message}`);
			return null;
		}
		return parsed.data;
	} catch {
		return null;
	}
}

async function cacheFresh(): Promise<boolean> {
	try {
		const st = await stat(cacheFile());
		return Date.now() - st.mtimeMs < CACHE_TTL_MS;
	} catch {
		return false;
	}
}

async function writeCache(index: RegistryIndex): Promise<void> {
	try {
		await mkdir(cacheDir(), { recursive: true });
		await writeFile(cacheFile(), JSON.stringify(index, null, 2), "utf8");
	} catch (err) {
		logForDebugging(`[registry] cache write failed: ${(err as Error).message}`);
	}
}

// Fetch the registry index. Returns cached copy when fresh or offline; fetches
// remotely otherwise. Network failure falls back to stale cache (best-effort),
// never throws — discover renders whatever it has.
export async function fetchRegistryIndex(
	url: string = defaultRegistryUrl(),
): Promise<RegistryIndex> {
	if (isOffline()) {
		logForDebugging("[registry] offline — using cache only");
		return (await readCache()) ?? { schemaVersion: 0, plugins: [] };
	}
	if (await cacheFresh()) {
		const cached = await readCache();
		if (cached) {
			logForDebugging(`[registry] cache hit (${cached.plugins.length} entries)`);
			return cached;
		}
	}
	try {
		const res = await axios.get(url, { timeout: 10_000, responseType: "json" });
		const parsed = RegistryIndexSchema.safeParse(res.data);
		if (!parsed.success) {
			logForDebugging(`[registry] remote parse failed: ${parsed.error.message}`);
			return (await readCache()) ?? { schemaVersion: 0, plugins: [] };
		}
		await writeCache(parsed.data);
		logForDebugging(
			`[registry] fetched ${parsed.data.plugins.length} entries from ${url}`,
		);
		return parsed.data;
	} catch (err) {
		logForDebugging(`[registry] fetch failed: ${(err as Error).message}`);
		return (await readCache()) ?? { schemaVersion: 0, plugins: [] };
	}
}
