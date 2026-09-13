import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getMaxOutputTokensForModel } from "../services/api/index.js";
import {
	getCompactOutputTokenCap,
	isContextWindowExceededError,
} from "../services/compact/index.js";
import { getContextWindowForModel } from "../utils/context.js";
import { isFusionMlxProvider } from "../utils/model/providers.js";

const CLOUD_MODEL = "glm5.2";

function setCloudEnv(): void {
	process.env.FUSION_API_KEY = "test-cloud-key";
	delete process.env.FUSION_MLX_ENABLED;
	delete process.env.FUSION_GATEWAY_ENABLED;
	delete process.env.FUSION_MLX_DISABLED;
	delete process.env.FUSION_CODE_MAX_OUTPUT_TOKENS;
}

function setMlxEnv(): void {
	delete process.env.FUSION_API_KEY;
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.FUSION_BASE_URL;
	delete process.env.ANTHROPIC_BASE_URL;
	// 显式置 MLX, 不靠 fallthrough (测试环境可能带 ANTHROPIC_API_KEY/base_url → firstParty)
	process.env.FUSION_MLX_ENABLED = "1";
	delete process.env.FUSION_CODE_MAX_OUTPUT_TOKENS;
}

const savedEnv: Record<string, string | undefined> = {};

describe("getCompactOutputTokenCap", () => {
	beforeEach(() => {
		for (const k of [
			"FUSION_API_KEY",
			"ANTHROPIC_API_KEY",
			"FUSION_BASE_URL",
			"ANTHROPIC_BASE_URL",
			"FUSION_MLX_ENABLED",
			"FUSION_GATEWAY_ENABLED",
			"FUSION_MLX_DISABLED",
			"FUSION_CODE_MAX_OUTPUT_TOKENS",
		]) {
			savedEnv[k] = process.env[k];
		}
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("MLX provider always returns undefined (MLX has its own preflight)", () => {
		setMlxEnv();
		expect(isFusionMlxProvider(CLOUD_MODEL)).toBe(true);
		expect(getCompactOutputTokenCap(CLOUD_MODEL, 30_000)).toBeUndefined();
	});

	it("cloud model returns undefined when input + candidate fits context window", () => {
		setCloudEnv();
		expect(isFusionMlxProvider(CLOUD_MODEL)).toBe(false);
		const ctx = getContextWindowForModel(CLOUD_MODEL);
		const candidate = Math.min(20_000, getMaxOutputTokensForModel(CLOUD_MODEL));
		const safeInput = ctx - candidate - 10_000;
		expect(getCompactOutputTokenCap(CLOUD_MODEL, safeInput)).toBeUndefined();
	});

	it("cloud model caps output when input + candidate overflows context window", () => {
		setCloudEnv();
		const ctx = getContextWindowForModel(CLOUD_MODEL);
		const candidate = Math.min(20_000, getMaxOutputTokensForModel(CLOUD_MODEL));
		const overflowInput = ctx - candidate + 5_000;
		const cap = getCompactOutputTokenCap(CLOUD_MODEL, overflowInput);
		expect(cap).toBeDefined();
		const expected = Math.max(2_048, ctx - overflowInput - 4_096);
		expect(cap).toBe(expected);
	});

	it("reproduces the reported bug: 180001 input on 200k window is capped, not 400", () => {
		setCloudEnv();
		const cap = getCompactOutputTokenCap(CLOUD_MODEL, 180_001);
		expect(cap).toBeDefined();
		expect(cap).toBeLessThan(20_000);
		const ctx = getContextWindowForModel(CLOUD_MODEL);
		expect(180_001 + cap).toBeLessThan(ctx);
	});

	it("exact-equality case also caps (input + candidate == contextWindow)", () => {
		setCloudEnv();
		const ctx = getContextWindowForModel(CLOUD_MODEL);
		const candidate = Math.min(20_000, getMaxOutputTokensForModel(CLOUD_MODEL));
		const exactInput = ctx - candidate;
		expect(getCompactOutputTokenCap(CLOUD_MODEL, exactInput)).toBeDefined();
	});

	it("respects the 2048 floor when input nearly fills the window", () => {
		setCloudEnv();
		const ctx = getContextWindowForModel(CLOUD_MODEL);
		const nearFullInput = ctx - 1_000;
		const cap = getCompactOutputTokenCap(CLOUD_MODEL, nearFullInput);
		expect(cap).toBe(2_048);
	});
});

describe("isContextWindowExceededError", () => {
	it("returns false for null/empty", () => {
		expect(isContextWindowExceededError(null)).toBe(false);
		expect(isContextWindowExceededError("")).toBe(false);
	});

	it("matches litellm ContextWindowExceededError token", () => {
		expect(
			isContextWindowExceededError("litellm.ContextWindowExceededError"),
		).toBe(true);
		expect(
			isContextWindowExceededError(
				"400 Bad Request: ContextWindowExceededError: ...",
			),
		).toBe(true);
	});

	it("matches openai-style maximum context length error", () => {
		expect(
			isContextWindowExceededError(
				"This model's maximum context length of 200000 tokens. However, your messages resulted in 180001 input tokens and 20000 output tokens (200001 total)",
			),
		).toBe(true);
	});

	it("rejects unrelated error strings", () => {
		expect(
			isContextWindowExceededError("Prompt is too long. 294200 > 200000"),
		).toBe(false);
		expect(isContextWindowExceededError("500 Internal Server Error")).toBe(
			false,
		);
		expect(isContextWindowExceededError("MLX server error: OOM")).toBe(false);
	});

	it("rejects partial openai-style (missing output tokens)", () => {
		expect(
			isContextWindowExceededError(
				"maximum context length of 200000 tokens. input tokens only",
			),
		).toBe(false);
	});
});
