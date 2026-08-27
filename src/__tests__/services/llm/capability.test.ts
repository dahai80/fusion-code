import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// No mock.module here: the real adapter's getMlxModelCapabilities probes the
// local MLX server via getFusionMlxModels(), which catches ECONNREFUSED and
// returns [] fast (MLX down in CI). Heuristic caps then derive from the model
// id alone — exactly what we assert. Mocking the whole adapter namespace would
// break createFusionMlxFetch importers across the llm graph; mocking one export
// replaces the namespace and loses the rest. Real adapter = no flakiness.

const {
	MlxCapabilityProvider,
	FirstPartyCapabilityProvider,
	GatewayCapabilityProvider,
	createLlmCapability,
} = await import("../../../services/llm/capability.js");
const { createCtx } = await import("../../../services/llm/ctx.js");

// Isolate provider env: clear provider-redirect envs so factory picks firstParty
// by default for non-MLX model ids. Restore after each test.
const ENV_KEYS = [
	"FUSION_GATEWAY_ENABLED",
	"FUSION_MLX_ENABLED",
	"FUSION_MLX_DISABLED",
	"FUSION_CODE_USE_BEDROCK",
	"FUSION_CODE_USE_VERTEX",
	"FUSION_CODE_USE_FOUNDRY",
	"FUSION_CODE_USE_OPENAI",
	"FUSION_API_KEY",
	"ANTHROPIC_API_KEY",
	"FUSION_CODE_CTX_EXEC_ENABLED",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	// firstParty needs a key to be selected by getAPIProvider.
	process.env.FUSION_API_KEY = "sk-ant-test";
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) {
			delete process.env[k];
		} else {
			process.env[k] = saved[k];
		}
	}
});

describe("MlxCapabilityProvider", () => {
	test("small model reuses heuristic: toolCalling false (≤3B)", async () => {
		// 3b matches isSmallModel regex \b(0\.5b|1b|2b|3b)\b → small → toolCalling false.
		const cap = await MlxCapabilityProvider.create("qwen2.5-3b-instruct");
		expect(cap.provider).toBe("fusionMlx");
		expect(cap.modelId).toBe("qwen2.5-3b-instruct");
		expect(cap.supportsToolCalling()).toBe(false);
		expect(cap.supportsStreaming()).toBe(true);
		expect(cap.supportsVision()).toBe(false);
		// small + base-excluded; structuredKeywords only fire for non-small.
		expect(cap.supportsStructuredOutput()).toBe(false);
		expect(cap.maxInputTokens()).toBe(16384);
		expect(cap.maxOutputTokens()).toBe(2048);
		// MLX models lack the thinking protocol — parity with old path.
		expect(cap.supportsThinking()).toBe(false);
	});

	test("mid instruct model: toolCalling + structured true (qwen3 keyword)", async () => {
		// 8b matches isMediumModel; qwen3 in structuredKeywords → structured true.
		const cap = await MlxCapabilityProvider.create("qwen3-8b-instruct");
		expect(cap.supportsToolCalling()).toBe(true);
		expect(cap.supportsStructuredOutput()).toBe(true);
		expect(cap.supportsVision()).toBe(false);
		expect(cap.maxInputTokens()).toBe(32768);
	});

	test("vision variant: supportsVision true (vl keyword)", async () => {
		// qwen2-vl is in visionKeywords; 7b → medium → toolCalling true.
		const cap = await MlxCapabilityProvider.create("qwen2-vl-7b");
		expect(cap.supportsVision()).toBe(true);
		expect(cap.supportsToolCalling()).toBe(true);
	});
});

describe("FirstPartyCapabilityProvider", () => {
	test("known structured-output model ids return true", () => {
		for (const m of [
			"claude-sonnet-4-6",
			"claude-sonnet-4-5",
			"claude-opus-4-1",
			"claude-opus-4-5",
			"claude-opus-4-6",
			"claude-haiku-4-5",
		]) {
			const cap = new FirstPartyCapabilityProvider(m);
			expect(cap.supportsStructuredOutput(), m).toBe(true);
			expect(cap.provider).toBe("firstParty");
		}
	});

	test("non-structured model ids return false", () => {
		const cap = new FirstPartyCapabilityProvider("claude-sonnet-4");
		expect(cap.supportsStructuredOutput()).toBe(false);
	});

	test("thinking: non-claude-3 models true, claude-3- false", () => {
		expect(
			new FirstPartyCapabilityProvider("claude-sonnet-4-6").supportsThinking(),
		).toBe(true);
		expect(
			new FirstPartyCapabilityProvider("claude-3-haiku").supportsThinking(),
		).toBe(false);
	});

	test("maxOutputTokens mirrors static table", () => {
		expect(
			new FirstPartyCapabilityProvider("claude-opus-4-6").maxOutputTokens(),
		).toBe(128_000);
		expect(
			new FirstPartyCapabilityProvider("claude-sonnet-4-6").maxOutputTokens(),
		).toBe(128_000);
		expect(
			new FirstPartyCapabilityProvider("claude-3-opus").maxOutputTokens(),
		).toBe(4_096);
	});

	test("unknown model id → conservative defaults", () => {
		const cap = new FirstPartyCapabilityProvider("some-unknown-model-x");
		expect(cap.supportsStreaming()).toBe(true);
		expect(cap.supportsToolCalling()).toBe(true);
		// Unknown id not in structured allowlist → false (conservative).
		expect(cap.supportsStructuredOutput()).toBe(false);
		// Unknown non-claude-3 id → thinking true (1P branch: !claude-3-).
		expect(cap.supportsThinking()).toBe(true);
		expect(cap.maxInputTokens()).toBe(200_000);
		// No table hit → default max output.
		expect(cap.maxOutputTokens()).toBe(8_192);
	});
});

describe("GatewayCapabilityProvider", () => {
	test("foundry: structured true, thinking = !claude-3-", () => {
		const cap = new GatewayCapabilityProvider("claude-sonnet-4-6", "foundry");
		expect(cap.provider).toBe("foundry");
		expect(cap.supportsStructuredOutput()).toBe(true);
		expect(cap.supportsThinking()).toBe(true);
		expect(cap.supportsVision()).toBe(false);
	});

	test("bedrock: structured false, thinking only sonnet-4/opus-4", () => {
		const bedrockSonnet = new GatewayCapabilityProvider(
			"claude-sonnet-4",
			"bedrock",
		);
		expect(bedrockSonnet.supportsStructuredOutput()).toBe(false);
		expect(bedrockSonnet.supportsThinking()).toBe(true);

		const bedrock3 = new GatewayCapabilityProvider("claude-3-haiku", "bedrock");
		expect(bedrock3.supportsThinking()).toBe(false);
	});

	test("vertex: structured false, thinking only sonnet-4/opus-4", () => {
		const cap = new GatewayCapabilityProvider("claude-opus-4", "vertex");
		expect(cap.supportsStructuredOutput()).toBe(false);
		expect(cap.supportsThinking()).toBe(true);
		expect(cap.maxInputTokens()).toBe(200_000);
		expect(cap.maxOutputTokens()).toBe(8_192);
	});

	test("openai provider: structured false, thinking false for non-4 models", () => {
		const cap = new GatewayCapabilityProvider("gpt-4o", "openai");
		expect(cap.supportsStructuredOutput()).toBe(false);
		expect(cap.supportsThinking()).toBe(false);
	});
});

describe("createLlmCapability factory", () => {
	test("MLX model name → MlxCapabilityProvider", async () => {
		// isMlxModelName: startsWith mlx-community / mlx- / includes mlx/
		// 3b → small → toolCalling false (real heuristic, MLX down in test).
		const cap = await createLlmCapability("mlx-community/qwen2.5-3b");
		expect(cap.provider).toBe("fusionMlx");
		expect(cap.supportsToolCalling()).toBe(false);
	});

	test("firstParty (FUSION_API_KEY set) → FirstPartyCapabilityProvider", async () => {
		const cap = await createLlmCapability("claude-sonnet-4-6");
		expect(cap.provider).toBe("firstParty");
		expect(cap.supportsStructuredOutput()).toBe(true);
	});

	test("foundry env → GatewayCapabilityProvider", async () => {
		// foundry env gate (line 54) returns before key check + MLX fallback.
		delete process.env.FUSION_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		process.env.FUSION_CODE_USE_FOUNDRY = "1";
		const cap = await createLlmCapability("claude-sonnet-4-6");
		expect(cap.provider).toBe("foundry");
		expect(cap.supportsStructuredOutput()).toBe(true);
	});
});

describe("createCtx envelope", () => {
	test("carries llm + cwd + sessionId (firstParty)", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp/proj", "sess-1");
		expect(ctx.llm.provider).toBe("firstParty");
		expect(ctx.llm.modelId).toBe("claude-sonnet-4-6");
		expect(ctx.cwd).toBe("/tmp/proj");
		expect(ctx.sessionId).toBe("sess-1");
	});

	test("llm capability reads via ctx.llm", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "s");
		expect(ctx.llm.supportsStructuredOutput()).toBe(true);
		expect(ctx.llm.supportsThinking()).toBe(true);
		expect(ctx.llm.supportsToolCalling()).toBe(true);
	});

	test("ctx.llm.modelId matches input (seam guard parity)", async () => {
		const model = "claude-3-haiku";
		const ctx = await createCtx(model, "/tmp", "s");
		// consumer guard `ctx.llm.modelId === model` must hold for seam use.
		expect(ctx.llm.modelId).toBe(model);
		expect(ctx.llm.supportsThinking()).toBe(false);
	});
});

describe("createCtx fs/tools/exec seams (PR #4)", () => {
	test("ctx.fs populated (LocalFsCapability, provider local)", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-fs");
		expect(ctx.fs).toBeDefined();
		expect(ctx.fs.provider).toBe("local");
	});

	test("ctx.fs.read round-trips a write", async () => {
		const { mkdtemp, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "ctx-seam-"));
		try {
			const ctx = await createCtx("claude-sonnet-4-6", dir, "sess-fs-io");
			const path = join(dir, "seam.txt");
			await ctx.fs.write(path, "seam-data");
			expect(await ctx.fs.read(path)).toBe("seam-data");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("ctx.tools populated (BaseToolsCapability, provider base)", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-tools");
		expect(ctx.tools).toBeDefined();
		expect(ctx.tools.provider).toBe("base");
		// Bash always enabled → list non-empty.
		expect(ctx.tools.list()).toContain("Bash");
	});

	test("ctx.tools.getTool('Bash') defined via seam", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-tools2");
		expect(ctx.tools.getTool("Bash")?.name).toBe("Bash");
	});

	test("ctx.exec undefined when FUSION_CODE_CTX_EXEC_ENABLED off (byte-identical default)", async () => {
		delete process.env.FUSION_CODE_CTX_EXEC_ENABLED;
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-exec-off");
		expect(ctx.exec).toBeUndefined();
	});

	test("ctx.sandbox undefined by default (not injected)", async () => {
		const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-sandbox");
		expect(ctx.sandbox).toBeUndefined();
	});

	test("ctx.exec defined when FUSION_CODE_CTX_EXEC_ENABLED=1", async () => {
		process.env.FUSION_CODE_CTX_EXEC_ENABLED = "1";
		try {
			const ctx = await createCtx("claude-sonnet-4-6", "/tmp", "sess-exec-on");
			expect(ctx.exec).toBeDefined();
			// backend picks executor if routable, else in-process — both valid.
			expect(["in-process", "executor"]).toContain(ctx.exec?.backend);
		} finally {
			delete process.env.FUSION_CODE_CTX_EXEC_ENABLED;
		}
	});
});
