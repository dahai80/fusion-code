import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock axios so discover tests never hit the network. registryIndex imports
// axios at module load, so we mock the default export before importing.
const fakeIndex = {
	schemaVersion: 0,
	updated: "2026-08-27T00:00:00Z",
	plugins: [
		{
			name: "github-helper",
			version: "1.2.0",
			description: "GitHub workflow plugin",
			category: "official",
			source: {
				type: "github",
				repo: "dahai80/fusion-plugins-official",
				path: "plugins/github-helper",
			},
			sha256: "abc123",
		},
		{
			name: "community-weather",
			description: "Weather lookup from community",
			category: "community",
			source: {
				type: "git",
				url: "https://github.com/someone/weather-plugin.git",
			},
		},
		{
			name: "builtin-uiux",
			description: "Ships with the binary",
			category: "official",
			builtin: true,
			source: { type: "directory", path: "internal/uiux" },
		},
		{
			name: "archived-tool",
			description: "Distributed as a zip archive",
			category: "other",
			source: { type: "archive", url: "https://example.com/tool.zip" },
			sha256: "deadbeef",
		},
	],
};

mock.module("axios", () => ({
	default: {
		get: mock(async (_url: string) => ({ data: fakeIndex })),
	},
}));

const { parseDiscoverArgs, discoverPlugins } = await import(
	"../../../commands/plugins/discover.js"
);
const { isOffline } = await import("../../../utils/plugins/registryIndex.js");

const savedEnv: Record<string, string | undefined> = {};
let tmpConfigDir = "";

beforeEach(async () => {
	for (const k of [
		"FUSION_OFFLINE",
		"FUSION_CODE_PLUGIN_REGISTRY_URL",
		"FUSION_CODE_REGISTRY_CACHE_DIR",
	]) {
		savedEnv[k] = process.env[k];
		delete process.env[k];
	}
	// Isolate registry cache to a per-test tmp dir (Rule 5: no real-disk writes).
	// registryIndex resolves cacheFile() lazily, so setting this here is honored.
	tmpConfigDir = await mkdtemp(join(tmpdir(), "discover-test-"));
	process.env.FUSION_CODE_REGISTRY_CACHE_DIR = tmpConfigDir;
});

afterEach(async () => {
	for (const k of Object.keys(savedEnv)) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	if (tmpConfigDir) {
		await rm(tmpConfigDir, { recursive: true, force: true }).catch(() => {});
		tmpConfigDir = "";
	}
});

describe("parseDiscoverArgs", () => {
	test("empty → all source, empty query", () => {
		expect(parseDiscoverArgs("")).toEqual({ query: "", source: "all" });
	});

	test("bare query → query set, source all", () => {
		expect(parseDiscoverArgs("github")).toEqual({
			query: "github",
			source: "all",
		});
	});

	test("--source=official flag", () => {
		expect(parseDiscoverArgs("--source=official")).toEqual({
			query: "",
			source: "official",
		});
	});

	test("query + --source=community", () => {
		expect(parseDiscoverArgs("weather --source=community")).toEqual({
			query: "weather",
			source: "community",
		});
	});

	test("--source official spaced form", () => {
		expect(parseDiscoverArgs("--source official")).toEqual({
			query: "",
			source: "official",
		});
	});

	test("unknown source normalizes to all", () => {
		expect(parseDiscoverArgs("--source=bogus")).toEqual({
			query: "",
			source: "all",
		});
	});
});

describe("discoverPlugins", () => {
	test("lists all entries when no filter", async () => {
		const res = await discoverPlugins({ query: "", source: "all" });
		expect(res.type).toBe("text");
		expect(res.value).toContain("github-helper");
		expect(res.value).toContain("community-weather");
		expect(res.value).toContain("builtin-uiux");
		expect(res.value).toContain("Discovered plugins (4");
	});

	test("query filters by name", async () => {
		const res = await discoverPlugins({ query: "weather", source: "all" });
		expect(res.value).toContain("community-weather");
		expect(res.value).not.toContain("github-helper");
	});

	test("query filters by description substring", async () => {
		const res = await discoverPlugins({ query: "zip", source: "all" });
		expect(res.value).toContain("archived-tool");
	});

	test("--source=official shows official + builtin", async () => {
		const res = await discoverPlugins({ query: "", source: "official" });
		expect(res.value).toContain("github-helper");
		expect(res.value).toContain("builtin-uiux");
		expect(res.value).not.toContain("community-weather");
	});

	test("--source=community shows only community", async () => {
		const res = await discoverPlugins({ query: "", source: "community" });
		expect(res.value).toContain("community-weather");
		expect(res.value).not.toContain("github-helper");
	});

	test("--source=archive filters by source type", async () => {
		const res = await discoverPlugins({ query: "", source: "archive" });
		expect(res.value).toContain("archived-tool");
		expect(res.value).not.toContain("github-helper");
	});

	test("--source=git filters by source type", async () => {
		const res = await discoverPlugins({ query: "", source: "git" });
		expect(res.value).toContain("community-weather");
		expect(res.value).not.toContain("archived-tool");
	});

	test("builtin entries get [builtin] tag", async () => {
		const res = await discoverPlugins({ query: "builtin", source: "all" });
		expect(res.value).toContain("[builtin]");
	});

	test("official entries get [official] tag", async () => {
		const res = await discoverPlugins({
			query: "github-helper",
			source: "all",
		});
		expect(res.value).toContain("[official]");
	});
});

describe("discoverPlugins offline", () => {
	test("FUSION_OFFLINE=1 with empty registry → offline note, no throw", async () => {
		// Point registry at a URL whose fetch we override to return empty.
		process.env.FUSION_OFFLINE = "1";
		// Re-mock axios to return empty index for this test.
		const { default: axiosMod } = await import("axios");
		(axiosMod.get as ReturnType<typeof mock>).mockImplementation(async () => ({
			data: { schemaVersion: 0, plugins: [] },
		}));
		const res = await discoverPlugins({ query: "", source: "all" });
		expect(isOffline()).toBe(true);
		expect(res.value).toContain("Offline mode");
	});
});
