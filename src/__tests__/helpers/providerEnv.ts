// 审计 v3-0913 P2-3: 统一 provider 相关 env 的测试隔离。
// 此前 capability.test.ts / sideQueryCtxSeam.test.ts 各自维护一份
// ENV_KEYS + saved/restore harness, 且 ENV_KEYS 漏了 baseUrl/model 路由
// key — 用例内裸 delete 的 key 不在列表里时不会被 afterEach 还原,
// 宿主 shell env 会被永久删掉并跨文件泄漏。统一从这里取。

export const PROVIDER_ENV_KEYS = [
	"FUSION_GATEWAY_ENABLED",
	"FUSION_MLX_ENABLED",
	"FUSION_MLX_DISABLED",
	"FUSION_CODE_USE_BEDROCK",
	"FUSION_CODE_USE_VERTEX",
	"FUSION_CODE_USE_FOUNDRY",
	"FUSION_CODE_USE_OPENAI",
	"FUSION_API_KEY",
	"ANTHROPIC_API_KEY",
	"FUSION_BASE_URL",
	"ANTHROPIC_BASE_URL",
	"FUSION_MLX_BASE_URL",
	"FUSION_GATEWAY_URL",
	"FUSION_MODEL",
	"FUSION_CODE_CTX_EXEC_ENABLED",
] as const;

import { beforeEach, afterEach } from "bun:test";

const saved: Record<string, string | undefined> = {};

/**
 * Register beforeEach/afterEach isolation for provider-routing env vars:
 * clear them before each test (caller then sets what the case needs) and
 * restore the original host values after each test.
 *
 * `defaults` are applied after the clear on every test (e.g. the
 * firstParty-default key both call sites previously set in their own
 * beforeEach).
 */
export function installProviderEnvIsolation(
	defaults: Record<string, string> = {},
): void {
	beforeEach(() => {
		for (const k of PROVIDER_ENV_KEYS) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
		for (const [k, v] of Object.entries(defaults)) {
			process.env[k] = v;
		}
	});

	afterEach(() => {
		for (const k of PROVIDER_ENV_KEYS) {
			if (saved[k] === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = saved[k];
			}
		}
	});
}
