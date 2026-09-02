import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// insight-0902 E1: SessionEnd auto-collect gate + fail-open.
// isTrajectoryAutoCollectEnabled reads FUSION_CODE_TRAJECTORY_AUTOCOLLECT.
// autoCollectTrajectoryOnSessionEnd: gate-off → no collect; gate-on → collect
// called with DEFAULT source/dest/product; collect throw → fail-open (no throw).

const ENV_KEY = "FUSION_CODE_TRAJECTORY_AUTOCOLLECT";

// Stub collectTrajectories so we can assert it's called/rejected without
// touching the filesystem (~/.fusion/trajectories). Must stub full surface.
let collectCalls: Array<{ sourceDir: string; destDir: string; product: string }> = [];
let collectShouldThrow = false;
mock.module("../../services/trajectory/collector.js", () => ({
	collectTrajectories: async (opts: { sourceDir: string; destDir: string; product: string }) => {
		collectCalls.push(opts);
		if (collectShouldThrow) {
			throw new Error("simulated collect failure");
		}
		return {
			version: 1,
			generatedAt: "2026-09-02T00:00:00.000Z",
			destDir: opts.destDir,
			sessions: [],
			totals: { sessions: 0, steps: 0, toolUse: 0, toolError: 0, positive: 0, selfCorrection: 0 },
		};
	},
	DEFAULT_SOURCE_DIR: "/mock/source",
	DEFAULT_DEST_DIR: "/mock/dest",
	// barrel re-exports these from collector.js — full surface required by
	// mock.module (partial mock throws Export-named-not-found at link time).
	loadCollectedTrajectory: () => null,
	MANIFEST_VERSION: 1,
	readManifest: () => null,
}));

// Stub isTestEnv so the ON-path test actually runs collect (real isTestEnv is
// true in bun:test, which skips collect — that's the production guard, but we
// must bypass it here to exercise the collect path).
let mockIsTestEnv = false;
mock.module("../../utils/buildConstants.js", () => ({
	isTestEnv: () => mockIsTestEnv,
}));

// NOTE: do NOT mock envUtils.js or debug.js here. Bun shares the mock.module
// cache across ALL test files, so stubbing envUtils.isEnvTruthy would leak into
// executor/manager.test.ts (isExecutorEnabled uses the same fn) and break its
// truthy-value assertions. The real isEnvTruthy + logForDebugging are safe.

const { isTrajectoryAutoCollectEnabled, autoCollectTrajectoryOnSessionEnd } = await import(
	"../../services/trajectory/index.js"
);

describe("insight-0902 E1 — SessionEnd trajectory auto-collect", () => {
	beforeEach(() => {
		delete process.env[ENV_KEY];
		collectCalls = [];
		collectShouldThrow = false;
		mockIsTestEnv = false;
	});
	afterEach(() => {
		delete process.env[ENV_KEY];
		mockIsTestEnv = false;
	});

	test("gate off (env unset) → enabled false, no collect", async () => {
		expect(isTrajectoryAutoCollectEnabled()).toBe(false);
		await autoCollectTrajectoryOnSessionEnd();
		expect(collectCalls).toHaveLength(0);
	});

	test("gate on (env=1) → enabled true, collect called with default dirs + product", async () => {
		process.env[ENV_KEY] = "1";
		expect(isTrajectoryAutoCollectEnabled()).toBe(true);
		await autoCollectTrajectoryOnSessionEnd();
		expect(collectCalls).toHaveLength(1);
		expect(collectCalls[0]).toEqual({
			sourceDir: "/mock/source",
			destDir: "/mock/dest",
			product: "fusion-code",
		});
	});

	test("collect throws → fail-open (no throw escapes)", async () => {
		process.env[ENV_KEY] = "1";
		collectShouldThrow = true;
		// Must NOT throw — shutdown must not block on collect failure.
		await expect(autoCollectTrajectoryOnSessionEnd()).resolves.toBeUndefined();
		expect(collectCalls).toHaveLength(1);
	});

	test("test env → collect skipped even when gate on (production guard)", async () => {
		process.env[ENV_KEY] = "1";
		mockIsTestEnv = true;
		await autoCollectTrajectoryOnSessionEnd();
		expect(collectCalls).toHaveLength(0);
	});

	test("gate on with truthy variant 'true' → enabled", () => {
		process.env[ENV_KEY] = "true";
		expect(isTrajectoryAutoCollectEnabled()).toBe(true);
	});

	test("gate with non-truthy '0' → disabled (not a soft-truthy match)", () => {
		process.env[ENV_KEY] = "0";
		expect(isTrajectoryAutoCollectEnabled()).toBe(false);
	});
});
