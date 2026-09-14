import { describe, expect, test } from "bun:test";

// audit 1.1.2: prove the sideQuery → ctx.llm wiring is byte-identical for the
// migrated cloud path and that the fusionMlx provider stays on the old path
// (sideQuery passes ctx=undefined for MLX → old provider-if fallback).
// Real adapter: MLX probe fail-opens to [] (MLX down in CI), heuristics derive
// from model id alone — no flakiness (same stance as capability.test.ts).

const { createCtx } = await import("../../services/llm/index.js");
const { modelSupportsStructuredOutputs } = await import("../../utils/betas.js");
const { getAPIProvider } = await import("../../utils/model/providers.js");

// 审计 v3-0913 P2-3: harness 统一抽到 helpers/providerEnv.ts (补齐
// baseUrl/model 路由 key 的隔离, 此前裸 delete 的 key 不会被还原)。
const { installProviderEnvIsolation } = await import(
	"../helpers/providerEnv.js"
);

// firstParty selected by getAPIProvider when FUSION_API_KEY is a sk-ant- key.
installProviderEnvIsolation({ FUSION_API_KEY: "sk-ant-test" });

describe("sideQuery ctx.llm wiring (audit 1.1.2)", () => {
	test("firstParty: ctx-driven answer == no-ctx (old) answer — byte-identical", async () => {
		// Every model id: with-ctx must equal without-ctx on the firstParty path.
		const ids = [
			"claude-sonnet-4-6",
			"claude-sonnet-4-5",
			"claude-opus-4-1",
			"claude-opus-4-5",
			"claude-opus-4-6",
			"claude-haiku-4-5",
			"claude-sonnet-4",
			"claude-3-haiku",
			"some-unknown-model",
		];
		for (const model of ids) {
			expect(getAPIProvider(model)).toBe("firstParty");
			const ctx = await createCtx(model, "/tmp", "sess-wire");
			const viaCtx = modelSupportsStructuredOutputs(model, ctx);
			const viaOld = modelSupportsStructuredOutputs(model);
			expect(viaCtx, model).toBe(viaOld);
		}
	});

	test("firstParty structured models: ctx path returns true (beta enabled)", async () => {
		for (const model of [
			"claude-sonnet-4-6",
			"claude-opus-4-6",
			"claude-haiku-4-5",
		]) {
			const ctx = await createCtx(model, "/tmp", "sess-on");
			expect(modelSupportsStructuredOutputs(model, ctx), model).toBe(true);
		}
	});

	test("firstParty non-structured model: ctx path returns false (no beta)", async () => {
		const ctx = await createCtx("claude-sonnet-4", "/tmp", "sess-off");
		expect(modelSupportsStructuredOutputs("claude-sonnet-4", ctx)).toBe(false);
	});

	test("foundry: ctx-driven (capability-authoritative) returns true", async () => {
		// Foundry diverges from old path for non-allowlist names: capability says
		// provider===foundry → true (mirrors 1P). Old path also true for allowlist
		// names; for a non-allowlist foundry model new=true, old=false. This is the
		// intended capability-authoritative shift, accepted by the migration.
		delete process.env.FUSION_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		process.env.FUSION_CODE_USE_FOUNDRY = "1";
		expect(getAPIProvider("claude-sonnet-4-6")).toBe("foundry");
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-foundry");
		expect(modelSupportsStructuredOutputs("claude-sonnet-4-6", ctx)).toBe(true);
	});

	test("bedrock/vertex/openai: ctx path returns false (byte-identical to old)", async () => {
		delete process.env.FUSION_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		for (const env of [
			"FUSION_CODE_USE_BEDROCK",
			"FUSION_CODE_USE_VERTEX",
			"FUSION_CODE_USE_OPENAI",
		]) {
			process.env[env] = "1";
			const model = "claude-sonnet-4-6";
			expect(getAPIProvider(model)).not.toBe("firstParty");
			const ctx = await createCtx(model, "/tmp", `sess-${env}`);
			expect(modelSupportsStructuredOutputs(model, ctx), env).toBe(false);
			expect(modelSupportsStructuredOutputs(model, ctx), env).toBe(
				modelSupportsStructuredOutputs(model),
			);
			delete process.env[env];
		}
	});

	test("fusionMlx: sideQuery gate passes ctx=undefined → old path (byte-identical)", async () => {
		// This encodes the sideQuery wiring contract: MLX provider is excluded
		// from the ctx migration, so the call site passes undefined and the old
		// provider-if fallback runs. MLX qwen3 (capability would say true) must
		// still return false via the old path — the deferred divergence.
		// 新契约 (endpoint 统一): MLX 路由需显式 opt-in — 模型名嗅探已删除。
		delete process.env.FUSION_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.FUSION_BASE_URL;
		delete process.env.ANTHROPIC_BASE_URL;
		process.env.FUSION_MLX_ENABLED = "1";
		try {
			const mlxModel = "mlx-community/qwen3-8b-instruct";
			expect(getAPIProvider(mlxModel)).toBe("fusionMlx");
			// sideQuery passes ctx=undefined for MLX:
			const viaOld = modelSupportsStructuredOutputs(mlxModel, undefined);
			expect(viaOld).toBe(false);
			// (For reference: a ctx WOULD diverge — capability reads qwen3 keyword.)
			const ctx = await createCtx(mlxModel, "/tmp", "sess-mlx-ref");
			expect(modelSupportsStructuredOutputs(mlxModel, ctx)).toBe(true);
		} finally {
			delete process.env.FUSION_MLX_ENABLED;
		}
	});

	test("seam guard: mismatched ctx.llm.modelId falls back to old path", async () => {
		// betas.ts guard: ctx.llm.modelId === model. A ctx built for a DIFFERENT
		// model must NOT be read — falls through to provider-if (byte-identical).
		const ctxForOther = await createCtx("claude-sonnet-4-6", "/tmp", "sess-x");
		const result = modelSupportsStructuredOutputs(
			"claude-haiku-4-5",
			ctxForOther,
		);
		// Old path for claude-haiku-4-5 on firstParty → true (allowlist). Guard
		// rejects the mismatched ctx, so this is the OLD answer, not ctx's answer
		// (ctxForOther.llm is sonnet-4-6 → also true, so assert via a false case).
		const ctxForSonnet = await createCtx("claude-sonnet-4-6", "/tmp", "sess-y");
		// claude-sonnet-4 (no -5/-6) → old path false; ctx for sonnet-4-6 → true.
		// Mismatched guard must pick OLD (false), proving fallback not ctx read.
		expect(
			modelSupportsStructuredOutputs("claude-sonnet-4", ctxForSonnet),
		).toBe(false);
		expect(result).toBe(true);
	});
});
