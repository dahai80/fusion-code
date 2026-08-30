import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { _resetOriginalFetch } from "../../services/api/index.js";
import { detectMlxHealth } from "../../utils/doctorDiagnostic.js";

// detectMlxHealth probes MLX via fetchMlxStatus (/api/tags) + fetchMlxPs
// (/api/ps) + fetchMlxHealth (/v1/health). fetchMlxStatus/fetchMlxPs call
// globalThis.fetch directly; fetchMlxHealth uses adapter getOriginalFetch()
// (lazy-captured globalThis.fetch), so we _resetOriginalFetch() per test to
// force re-capture of the mocked fetch. We route all three by URL.
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

// /api/tags → { models: [{ name, size, quant }] }; /api/ps → { models: [{ name }] };
// /v1/health → MLXHealthResponse (status/oom_risk/memory…). health === null
// simulates fetchMlxHealth fail-open (401/timeout/network → null, OOM skip).
type HealthMock =
	| { oom_risk: "none" | "low" | "high" | "imminent"; memory?: object }
	| null
	| { status: number }; // { status: 401 } → 401 response

const mlxFetchImpl = (
	loaded: string[] | null,
	models: Array<{ name: string; size?: number; quant?: string }>,
	health: HealthMock = null,
): typeof fetch =>
	(async (input) => {
		const url = String(input);
		if (url.includes("/v1/health")) {
			// health === null → fetchMlxHealth fail-open (throw → null).
			if (health === null) throw new Error("health unreachable");
			if ("status" in health) {
				return mockResponse({ error: "auth" }, health.status);
			}
			return mockResponse({
				status: "ok",
				version: "test",
				uptime_seconds: 0,
				active_models: loaded ?? [],
				oom_risk: health.oom_risk,
				memory: health.memory,
			});
		}
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
	health: HealthMock = null,
) {
	return spyOn(globalThis, "fetch").mockImplementation(
		mlxFetchImpl(loaded, models, health),
	);
}

describe("detectMlxHealth", () => {
	let snap: Record<string, string | undefined>;

	beforeEach(() => {
		snap = snapshotEnvs();
		// fetchMlxHealth lazy-captures globalThis.fetch on first call; reset so
		// the per-test spyOn mock is re-captured rather than a stale real fetch.
		_resetOriginalFetch();
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

// ─── P4.2 #4 / fusion-mlx#564: proactive OOM detection ──────────
//
// detectMlxHealth probes /v1/health (fetchMlxHealth) only after a model is
// loaded (no point probing memory when nothing occupies it). oom_risk is a
// deterministic two-signal classifier computed by fusion-mlx; fusion-code just
// surfaces it. high/imminent → warning; none/low → silent; fetch fail-open
// (401/timeout/network → null) → skip, no false-positive.

describe("detectMlxHealth — OOM (#4, fusion-mlx#564)", () => {
	let snap: Record<string, string | undefined>;

	beforeEach(() => {
		snap = snapshotEnvs();
		_resetOriginalFetch();
	});

	afterEach(() => {
		restoreEnvs(snap);
		spyOn(globalThis, "fetch").mockRestore();
	});

	it("warns with imminent OOM risk and surfaces memory stats", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], {
			oom_risk: "imminent",
			memory: {
				rss_bytes: 4_000_000_000,
				used_bytes: 14_000_000_000,
				free_bytes: 500_000_000,
				total_bytes: 16_000_000_000,
				mlx_active_bytes: 8_000_000_000,
				mlx_cache_bytes: 4_000_000_000,
				mlx_peak_bytes: 15_000_000_000,
				per_model: [{ name: "qwen-coder", bytes: 4_000_000_000 }],
			},
		});
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("imminent");
		expect(warnings[0].issue).toContain("OOM");
		// memory stats surfaced (free/total/peak)
		expect(warnings[0].issue).toContain("MLX peak");
		expect(warnings[0].fix).toContain("/mlx gc");
		expect(warnings[0].fix).toContain("unload");
		// #7 fixAction framework: OOM warning carries a callable auto-fix (gc)
		expect(typeof warnings[0].fixAction).toBe("function");
	});

	it("warns with high OOM risk", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], {
			oom_risk: "high",
			memory: {
				rss_bytes: 3_000_000_000,
				used_bytes: 12_000_000_000,
				free_bytes: 2_000_000_000,
				total_bytes: 16_000_000_000,
				mlx_active_bytes: 6_000_000_000,
				mlx_cache_bytes: 4_000_000_000,
				mlx_peak_bytes: 12_000_000_000,
				per_model: [],
			},
		});
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("high");
		expect(warnings[0].issue).toContain("memory pressure");
		expect(warnings[0].fix).toContain("/mlx gc");
		// #7 fixAction framework: high OOM warning also carries callable gc fix
		expect(typeof warnings[0].fixAction).toBe("function");
	});

	it("no warning when oom_risk is low", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], {
			oom_risk: "low",
		});
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
	});

	it("no warning when oom_risk is none", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], {
			oom_risk: "none",
		});
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
	});

	it("no OOM warning when /v1/health fails (fail-open, e.g. MLX no key → 401)", async () => {
		forceMlxProvider();
		// health === null → /v1/health throws → fetchMlxHealth returns null → skip.
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], null);
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
	});

	it("no OOM warning when /v1/health returns 401 (management-gated, anonymous MLX)", async () => {
		forceMlxProvider();
		routeFetch(["qwen-coder"], [{ name: "qwen-coder" }], { status: 401 });
		const warnings = await detectMlxHealth();
		expect(warnings).toEqual([]);
	});

	it("OOM warning omitted when no model loaded (probed only after load)", async () => {
		forceMlxProvider();
		// No model loaded → early-return before fetchMlxHealth, even though
		// /v1/health would report imminent. The no-model warning wins.
		routeFetch([], [{ name: "qwen-coder" }], {
			oom_risk: "imminent",
		});
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(warnings[0].issue).toContain("no model loaded");
		expect(warnings[0].issue).not.toContain("imminent");
	});

	// ─── #7 fixAction framework: fixAction() is callable → POST /api/v1/gc ──
	// requestMlxGC (adapter :604) uses globalThis.fetch directly. The gc route
	// returns { mem_before, mem_after, freed } → { success: true, freed }.
	it("#7: OOM fixAction() calls /api/v1/gc and returns success", async () => {
		forceMlxProvider();
		let gcCalled = false;
		spyOn(globalThis, "fetch").mockImplementation(
			(async (input) => {
				const url = String(input);
				if (url.includes("/v1/health")) {
					return mockResponse({
						status: "ok",
						version: "test",
						uptime_seconds: 0,
						active_models: ["qwen-coder"],
						oom_risk: "high",
						memory: {
							rss_bytes: 3_000_000_000,
							used_bytes: 12_000_000_000,
							free_bytes: 2_000_000_000,
							total_bytes: 16_000_000_000,
							mlx_active_bytes: 6_000_000_000,
							mlx_cache_bytes: 4_000_000_000,
							mlx_peak_bytes: 12_000_000_000,
							per_model: [],
						},
					});
				}
				if (url.includes("/api/ps")) {
					return mockResponse({ models: [{ name: "qwen-coder" }] });
				}
				if (url.includes("/api/tags")) {
					return mockResponse({ models: [{ name: "qwen-coder" }] });
				}
				if (url.includes("/api/v1/gc")) {
					gcCalled = true;
					return mockResponse({ mem_before: 8000, mem_after: 3000, freed: 5000 });
				}
				throw new Error(`unexpected fetch url: ${url}`);
			}) as unknown as typeof fetch,
		);
		const warnings = await detectMlxHealth();
		expect(warnings).toHaveLength(1);
		expect(typeof warnings[0].fixAction).toBe("function");
		// fixAction is requestMlxGC — calling it triggers the gc endpoint.
		const result = (await warnings[0].fixAction!()) as { success: boolean; freed?: number };
		expect(gcCalled).toBe(true);
		expect(result.success).toBe(true);
		expect(result.freed).toBe(5000);
	});
});
