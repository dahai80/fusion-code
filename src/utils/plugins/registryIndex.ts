// registryIndex.ts — official registry.json fetch + cache (ar-plan PR #5, E1).
// /plugins discover pulls a curated plugin index (name/version/source/sha256/
// description/category) from a registry URL, caches it under
// ~/.fusion-code/marketplace-cache/ with a 1h TTL, and returns the entries.
// Pure index fetch — no telemetry sent back (privacy). FUSION_OFFLINE=1 skips
// the fetch and returns the cached index (or empty if none), so local builtin
// plugins stay usable offline. Byte-identical when no one calls discover.

import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { z } from "zod";
import { logForDebugging } from "../debug.js";
import { getClaudeConfigHomeDir, isEnvTruthy } from "../envUtils.js";

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
	source: z
		.object({
			type: z.enum(["git", "github", "archive", "directory"]),
			url: z.string().optional(),
			repo: z.string().optional(),
			ref: z.string().optional(),
			path: z.string().optional(),
		})
		.passthrough(),
	sha256: z.string().optional(),
	builtin: z.boolean().optional(),
});

export const RegistryIndexSchema = z.object({
	schemaVersion: z.number().int().default(0),
	updated: z.string().optional(),
	// P3-11: plugins 数组上限 — 恶意 registry 返百万条目, axios 缓冲后 schema parse
	// 全接, writeCache 写全数组填盘。加 .max(10000) 超限拒绝 parse 而非缓存。
	plugins: z.array(RegistryEntrySchema).max(10000),
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
	const override = process.env.FUSION_CODE_PLUGIN_REGISTRY_URL;
	if (override) {
		// P0-3 (audit 0901): supply-chain trust boundary. The registry index
		// carries per-plugin sha256 pins, BUT when the override URL points at a
		// non-default host, the pin and the payload come from the same channel —
		// a compromised/attacker registry can poison both consistently and the
		// sha256 check passes. The default registry is the only trusted origin;
		// an override is an explicit user opt-out of that trust. Fail visibly:
		// warn loudly so operators know they left a MITM-shaped env var set, and
		// refuse plaintext HTTP (localhost exempted for local testing).
		const lower = override.toLowerCase();
		const isLoopback =
			lower.startsWith("http://localhost") ||
			lower.startsWith("http://127.0.0.1") ||
			lower.startsWith("http://[::1]");
		if (!lower.startsWith("https://") && !isLoopback) {
			// Refuse: a plaintext remote registry can be tampered in transit and
			// the sha256 pin (also fetched in the clear) proves nothing.
			throw new Error(
				`[registry] FUSION_CODE_PLUGIN_REGISTRY_URL must be HTTPS (got "${override}"). ` +
					"Plaintext HTTP is only permitted for loopback (localhost/127.0.0.1). " +
					"A non-HTTPS registry can be tampered in transit and its sha256 pins " +
					"provide no integrity guarantee. Set a https:// URL or unset the env.",
			);
		}
		// HTTPS (or loopback) override: warn but proceed. The operator opted in.
		const hostHint = isLoopback ? "loopback" : "remote";
		logForDebugging(
			`[registry] WARNING: using non-default registry via FUSION_CODE_PLUGIN_REGISTRY_URL (${hostHint}: ${override}). ` +
				"sha256 pins are sourced from THIS registry, not the official one — " +
				"only trust an override you control.",
		);
	}
	return (
		override ??
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
		// P2-18: 目录 0700 + 文件 0600 非 0755/0644。cache 含插件元数据
		// (名/源 URL/sha256) = 用户浏览哪些插件的侧信道, 不应世界可读。
		await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
		await chmod(cacheDir(), 0o700).catch(() => {});
		await writeFile(cacheFile(), JSON.stringify(index, null, 2), {
			encoding: "utf8",
			mode: 0o600,
		});
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
			logForDebugging(
				`[registry] cache hit (${cached.plugins.length} entries)`,
			);
			return cached;
		}
	}
	try {
		// P1-27: maxContentLength/maxBodyLength 50MB — 防 OOM。responseType:"json"
		// 整 body 缓冲进内存再 parse, 恶意/被攻陷 registry (可 FUSION_CODE_PLUGIN_REGISTRY_URL
		// 覆盖) 返多 GB JSON → axios 缓冲 → OOM。parse 在全 body 进内存后。
		const res = await axios.get(url, {
			timeout: 10_000,
			responseType: "json",
			maxContentLength: 50_000_000,
			maxBodyLength: 50_000_000,
		});
		const parsed = RegistryIndexSchema.safeParse(res.data);
		if (!parsed.success) {
			logForDebugging(
				`[registry] remote parse failed: ${parsed.error.message}`,
			);
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
