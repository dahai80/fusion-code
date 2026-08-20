import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { detectMlxHealth } from "../../utils/doctorDiagnostic.js";

// detectMlxHealth probes MLX via fetchMlxStatus (/api/tags) + fetchMlxPs
// (/api/ps), both of which call globalThis.fetch. We route the mock by URL.
// shouldAutoUseFusionMlx (the probe gate) reads env, so each case snapshots +
// restores the relevant vars. process.env is process-global — isolation is
// mandatory.

const MLX_ENVS = [
	"FUSION_MLX_DISABLED",
	"FUSION_GATEWAY_ENABLED",
	"FUSION_MLX_ENABLED",
	"FUSION_MLX_AUTO",
	"FUSION_API_KEY",
	"ANTHROPIC_API_KEY",
	"FUSION_BASE_URL",
	"ANTHROPIC_BASE_URL",
	"FUSION_GATEWAY_URL",
	"FUSION_MLX_BASE_URL",
] as const;

function snapshotEnvs(): Record<string, string | undefined> {
	const snap: Record<string, string | undefined> = {};
	for (const k of MLX_ENVS) snap[k] = process.env[k];
	return snap;
}

function restoreEnvs(snap: Record<string, string | undefined>): void {
	for (const k of MLX_ENVS) {
		if (snap[k] === undefined) delete process.env[k];
		else process.env[k] = snap[k];
	}
}

function clearEnvs(): void {
	for (const k of MLX_ENVS) delete process.env[k];
}

// Force shouldAutoUseFusionMlx() === true (MLX is the configured provider):
// FUSION_MLX_ENABLED=1, not disabled, no cloud API key.
function forceMlxProvider(): void {
	clearEnvs();
	process.env.FUSION_MLX_ENABLED = "1";
}

// Force shouldAutoUseFusionMlx() === false (cloud active):
// no MLX envs, but a cloud API key is set.
function forceCloudProvider(): void {
	clearEnvs();
	process.env.FUSION_API_KEY = "sk-ant-cloud";
}

function mockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

// /api/tags → { models: [{ name, size, quant }] }; /api/ps → { models: [{ name }] }.
const mlxFetchImpl = (
	loaded: string[] | null,
	models: Array<{ name: string; size?: number; quant?: string }>,
): typeof fetch =>
	(async (input) => {
		const url = String(input);
		if (url.includes("/api/ps")) {
			// loaded === null simulates a /api/ps fetch failure → fetchMlxPs catches
			// and returns [], so we reject; fetchMlxPs' own try/catch swallows it.
			if (loaded === null) throw new Error("ps unreachable");
			return mockResponse({ models: loaded.map((name) => ({ name })) });
		}
		if (url.includes("/api/tags")) {
			return mockResponse({ models });
		}
		throw new Error(`unexpected fetch url: ${url}`);
	}) as typeof fetch;

function routeFetch(
	loaded: string[] | null,
	models: Array<{ name: string; size?: number; quant?: string }>,
) {
	return spyOn(globalThis, "fetch").mockImplementation(
		mlxFetchImpl(loaded, models),
	);
}

describe("detectMlxHealth", () => {
	let snap: Record<string, string | undefined>;

	beforeEach(() => {
		snap = snapshotEnvs();
	});

	afterEach(() => {
		restoreEnvs(snap);
		spyOn(globalThis, "fetch").mockRestore();
	});

	it("skips probing when MLX is not the configured provider (cloud active)", async () => {
		forceCloudProvider();
		const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
			(async () => {
				throw new Error("must not fetch when cloud active");
			}) as unknown as typeof fetch,
		);
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("warns when the MLX gateway is not reachable", async () => {
		forceMlxProvider();
		// /api/tags fails → fetchMlxStatus returns { connected: false, error }.
		spyOn(globalThis, "fetch").mockImplementation((async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch);
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("not reachable");
		expect(warnings[0].issue).toContain("127.0.0.1:11432");
		expect(warnings[0].issue).toContain("ECONNREFUSED");
		expect(warnings[0].fix).toContain("fusion service start mlx");
	});

	it("warns when MLX is connected but no model is loaded (models available)", async () => {
		forceMlxProvider();
		routeFetch(
			[],
			[{ name: "qwen-coder", size: 4_000_000_000 }, { name: "phi-mini" }],
		);
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("no model loaded");
		expect(warnings[0].issue).toContain("qwen-coder");
		expect(warnings[0].fix).toContain("fusion model load qwen-coder");
	});

	it("warns when MLX is connected, no model loaded, and no models available", async () => {
		forceMlxProvider();
		routeFetch([], []);
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("no model loaded");
		expect(warnings[0].fix).toContain("Download one via the model hub");
	});

	it("truncates the available-model list to 3 names with ellipsis", async () => {
		forceMlxProvider();
		routeFetch(
			[],
			[{ name: "m1" }, { name: "m2" }, { name: "m3" }, { name: "m4" }],
		);
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("m1");
		expect(warnings[0].issue).toContain("m3");
		expect(warnings[0].issue).not.toContain("m4");
		expect(warnings[0].issue).toContain("…");
	});

	it("returns no warnings when MLX is connected and a model is loaded", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }]);
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
	});
});
