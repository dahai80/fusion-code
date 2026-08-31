/**
 * P0-4 (audit R6): 云 provider 静默断裂 — openai 分支显式 throw 单测。
 *
 * 修前: FUSION_CODE_USE_OPENAI=1 无 dedicated 分支 → 沉默落入 firstParty
 * → 用 OpenAI key/model 名打 api.anthropic.com (语义错配, 401/404 静默失败)。
 * 修后: getAPIProvider 返回 "openai"; getAnthropicClient 命中 openai 分支显式
 * throw "OpenAI 直连已移除" 引导走 fusion-gateway (与 bedrock/vertex/foundry 同构)。
 *
 * 验收 (audit §9 P0-4): FUSION_CODE_USE_OPENAI=1 不再静默落 firstParty。
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// MACRO.VERSION/BUILD_TIME 是 build.ts --define 注入的编译时宏, 测试运行时未定义。
// getAnthropicClient 在模块加载时经 getUserAgent() (http.ts:34) 读 MACRO.VERSION →
// ReferenceError。预置全局 stub 让导入链不爆, 测试焦点在 openai 分支 throw 而非版本号。
;(globalThis as { MACRO?: Record<string, string> }).MACRO ??= {
	VERSION: "0.0.0-test",
	BUILD_TIME: "test",
	FEEDBACK_CHANNEL: "github",
	ISSUES_EXPLAINER: "report issues",
	PACKAGE_URL: "fusion-code",
	NATIVE_PACKAGE_URL: "undefined",
	VERSION_CHANGELOG: "",
};

const originalEnv = { ...process.env };

beforeEach(() => {
	// 清掉 MLX/gateway/key env, 确保 getAPIProvider 不走 fusionMlx/firstParty 分支
	delete process.env.FUSION_MLX_ENABLED;
	delete process.env.FUSION_GATEWAY_ENABLED;
	delete process.env.FUSION_MLX_DISABLED;
	delete process.env.FUSION_API_KEY;
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.FUSION_BASE_URL;
	delete process.env.ANTHROPIC_BASE_URL;
	delete process.env.FUSION_CODE_USE_OPENAI;
	delete process.env.FUSION_CODE_USE_FOUNDRY;
	delete process.env.FUSION_CODE_USE_BEDROCK;
	delete process.env.FUSION_CODE_USE_VERTEX;
});

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("P0-4 openai provider 显式 throw (audit R6)", () => {
	it("getAPIProvider: FUSION_CODE_USE_OPENAI=1 + MLX_DISABLED → 返回 openai (不落 firstParty)", async () => {
		process.env.FUSION_MLX_DISABLED = "1";
		process.env.FUSION_CODE_USE_OPENAI = "1";
		const { getAPIProvider } = await import(
			"../../../utils/model/providers.js"
		);
		expect(getAPIProvider("gpt-5.3-codex")).toBe("openai");
	});

	it("getAnthropicClient: FUSION_CODE_USE_OPENAI=1 → reject 含 'OpenAI 直连' (不静默落 firstParty)", async () => {
		process.env.FUSION_CODE_USE_OPENAI = "1";
		// MLX 不可用 (无 gateway/mlx env) → 跳过 MLX 路径, 命中 openai 分支
		// 经 api barrel 导入 (lint:layers:reverse 禁止 deep import src/services/**)
		const { getAnthropicClient } = await import(
			"../../../services/api/index.js"
		);
		await expect(
			getAnthropicClient({ maxRetries: 1, model: "gpt-5.3-codex" }),
		).rejects.toThrow(/OpenAI 直连/);
	});

	it("getAnthropicClient: 抛错文案引导 fusion-gateway", async () => {
		process.env.FUSION_CODE_USE_OPENAI = "1";
		const { getAnthropicClient } = await import(
			"../../../services/api/index.js"
		);
		await expect(
			getAnthropicClient({ maxRetries: 1, model: "gpt-5.3-codex" }),
		).rejects.toThrow(/fusion-gateway/);
	});
});
