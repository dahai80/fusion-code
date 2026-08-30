import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	MIN_BATCH_AGENTS,
	resolveBatchMaxAgents,
} from "../skills/bundled/batch.js";
import { DEFAULT_MAX_CONCURRENT_SUBAGENTS } from "../tools/AgentTool/subagentGuardrails.js";

// audit 1.4.7: batch skill prompt cap (MAX_AGENTS) must track the live env-aware
// hard cap, not a static default. If a user raises FUSION_MAX_CONCURRENT_SUBAGENTS,
// the prompt's "spawn N–M agents" range must rise with it — else the model spawns
// past the old default and subagentGuardrails rejects from the (N+1)th onward.
// resolveBatchMaxAgents() reads getMaxConcurrentSubagents() (same source as the
// spawn-time gate checkSubagentGuardrails) at CALL time, so env overrides propagate.

const ENV_KEY = "FUSION_MAX_CONCURRENT_SUBAGENTS";

describe("audit 1.4.7 — batch MAX_AGENTS env-aware (no drift vs hard cap)", () => {
	beforeEach(() => {
		delete process.env[ENV_KEY];
	});
	afterEach(() => {
		delete process.env[ENV_KEY];
	});

	test("unset env → default hard cap (20), no drift", () => {
		expect(resolveBatchMaxAgents()).toBe(DEFAULT_MAX_CONCURRENT_SUBAGENTS);
	});

	test("env override raises prompt cap WITH the hard cap", () => {
		// User raises concurrency to 30 — both the spawn gate and the prompt must
		// follow, else the model is told to spawn up to 20 while the gate allows 30
		// (under-provisioning) OR told 30 while the gate allows 20 (rejection spin).
		process.env[ENV_KEY] = "30";
		expect(resolveBatchMaxAgents()).toBe(30);
	});

	test("env override lowers cap, floored at MIN_BATCH_AGENTS", () => {
		// A valid-but-small env (3) is legal for the hard cap, but the prompt's
		// "N–M agents" range must never invert (MIN > MAX). resolveBatchMaxAgents
		// floors to MIN_BATCH_AGENTS so the template never renders "5–3".
		process.env[ENV_KEY] = "3";
		expect(resolveBatchMaxAgents()).toBe(MIN_BATCH_AGENTS);
	});

	test("invalid env (non-numeric) → default, no crash", () => {
		// getMaxConcurrentSubagents fails open to the default on garbage env.
		process.env[ENV_KEY] = "garbage";
		expect(resolveBatchMaxAgents()).toBe(DEFAULT_MAX_CONCURRENT_SUBAGENTS);
	});

	test("MIN_BATCH_AGENTS is a sane lower bound", () => {
		// The /batch skill decomposes work into at least MIN_BATCH_AGENTS units —
		// a sub-5 count means the work likely didn't need batch orchestration.
		expect(MIN_BATCH_AGENTS).toBeGreaterThanOrEqual(2);
	});
});
