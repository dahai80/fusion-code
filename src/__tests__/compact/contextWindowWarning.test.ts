// insight-0902 E2 tests: computeContextWindowWarning env gate + percent math.
// SUT-unique mock only (tokens.js tokenCountWithEstimation) — never mock
// envUtils/debug (mock.module is global across the bun:test run, see
// autoCollect lesson). Real isEnvTruthy handles the env gate.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { computeContextWindowWarning } from "../../services/compact/index.js";
import type { Message } from "../../types/message.js";

const GATE = "FUSION_CODE_CONTEXT_WINDOW_WARNING_HOOK";

// Stub the only SUT-unique dependency: the token estimator. Returns a
// deterministic nonzero count so the percent math is testable. tokens.js
// is not consumed by other unit-test files in this slice, so the global
// mock.module cache does not leak across the run.
mock.module("../../utils/tokens.js", () => ({
	tokenCountWithEstimation: () => 80000,
}));

function makeMessages(): Message[] {
	return [
		{ role: "user", content: [{ type: "text", text: "x" }] },
	] as unknown as Message[];
}

describe("computeContextWindowWarning", () => {
	const prev = process.env[GATE];
	const prevWindow = process.env.FUSION_CODE_AUTO_COMPACT_WINDOW;
	const prevBlocking = process.env.FUSION_CODE_BLOCKING_LIMIT_OVERRIDE;

	beforeEach(() => {
		delete process.env[GATE];
		delete process.env.FUSION_CODE_AUTO_COMPACT_WINDOW;
		delete process.env.FUSION_CODE_BLOCKING_LIMIT_OVERRIDE;
	});

	afterEach(() => {
		if (prev === undefined) delete process.env[GATE];
		else process.env[GATE] = prev;
		if (prevWindow === undefined)
			delete process.env.FUSION_CODE_AUTO_COMPACT_WINDOW;
		else process.env.FUSION_CODE_AUTO_COMPACT_WINDOW = prevWindow;
		if (prevBlocking === undefined)
			delete process.env.FUSION_CODE_BLOCKING_LIMIT_OVERRIDE;
		else process.env.FUSION_CODE_BLOCKING_LIMIT_OVERRIDE = prevBlocking;
	});

	it("does not fire when env gate is off (byte-identical default)", () => {
		const r = computeContextWindowWarning("claude-sonnet-5", makeMessages());
		expect(r.fire).toBe(false);
		expect(r.usagePercent).toBe(0);
	});

	it("fires when env gate is truthy and computes usage percent", () => {
		// Force a small, deterministic context window so the math is testable.
		process.env[GATE] = "1";
		process.env.FUSION_CODE_AUTO_COMPACT_WINDOW = "100000";
		const r = computeContextWindowWarning("claude-sonnet-5", makeMessages());
		expect(r.fire).toBe(true);
		expect(r.usagePercent).toBeGreaterThan(0);
		expect(r.usagePercent).toBeLessThanOrEqual(100);
		expect(r.thresholdPercent).toBeGreaterThan(0);
		expect(r.contextWindow).toBeGreaterThan(0);
		expect(r.tokenUsage).toBeGreaterThan(0);
	});

	it("thresholdPercent is the auto-compact threshold ratio", () => {
		process.env[GATE] = "1";
		process.env.FUSION_CODE_AUTO_COMPACT_WINDOW = "100000";
		const r = computeContextWindowWarning("claude-sonnet-5", makeMessages());
		// getAutoCompactThreshold is below the effective window, so the
		// threshold ratio is < 100% and > 0%.
		expect(r.thresholdPercent).toBeLessThan(100);
		expect(r.thresholdPercent).toBeGreaterThan(0);
		// usage is at-or-above threshold when this fn is reached (caller
		// guards on shouldCompact), but the fn itself does not re-check; it
		// just reports. Assert internal consistency only.
		expect(r.usagePercent).toBeGreaterThanOrEqual(0);
	});
});
