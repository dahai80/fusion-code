import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from "../../services/analytics/index.js";
import { isEnvTruthy } from "../envUtils.js";

export type APIProvider =
	| "firstParty"
	| "bedrock"
	| "vertex"
	| "foundry"
	| "openai"
	| "fusionMlx";

function isAnthropicApiKey(key: string | undefined): boolean {
	if (!key) return false;
	return key.startsWith("sk-ant-");
}

function hasThirdPartyProxyConfigured(): boolean {
	const baseUrl =
		process.env.FUSION_BASE_URL || process.env.ANTHROPIC_BASE_URL || "";
	return !!baseUrl && !baseUrl.includes("api.anthropic.com");
}

export function isMlxModelName(model: string | undefined): boolean {
	if (!model) return false;
	const lower = model.toLowerCase();
	return (
		lower.startsWith("mlx-community") ||
		lower.startsWith("mlx-") ||
		lower.includes("mlx/")
	);
}

export function getAPIProvider(_model?: string): APIProvider {
	if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
		if (isEnvTruthy(process.env.FUSION_CODE_USE_BEDROCK)) return "bedrock";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_VERTEX)) return "vertex";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) return "foundry";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) return "openai";
		return "firstParty";
	}
	if (isEnvTruthy(process.env.FUSION_CODE_USE_BEDROCK)) {
		return "bedrock";
	}
	if (isEnvTruthy(process.env.FUSION_CODE_USE_VERTEX)) {
		return "vertex";
	}
	if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
		return "foundry";
	}
	if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) {
		return "openai";
	}
	// #221 拓扑语义: key 选择凭证, 不选择拓扑。显式本地 opt-in
	// (FUSION_MLX_ENABLED / FUSION_GATEWAY_ENABLED / FUSION_MLX_BASE_URL /
	// FUSION_GATEWAY_URL) 是明确的部署事实, 不得被 FUSION_API_KEY 的
	// 存在压过 — 按 doc 配了规范 key 的本地用户会被静默拽回云端
	// firstParty (live 401 repro 的另一半根因)。
	if (
		isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) ||
		isEnvTruthy(process.env.FUSION_MLX_ENABLED) ||
		process.env.FUSION_MLX_BASE_URL ||
		process.env.FUSION_GATEWAY_URL
	) {
		return "fusionMlx";
	}
	// Canonical config: FUSION_BASE_URL + FUSION_API_KEY (+ FUSION_MODEL) →
	// firstParty direct connect. API key 优先于一切推断 — 客户端不猜测用户的
	// LLM 跑在哪里 (协议兼容即直连); 但显式 opt-in 是明示意图, 排在 key 之前。
	// 修复 (401 根因): 此前 isMlxModelName() 模型名嗅探排在 key 检查之前,
	// FUSION_MODEL 为 MLX 风格名字时劫持已配 key 的会话走本地 adapter,
	// 用错误的凭证体系 (FUSION_GATEWAY_API_KEY) 鉴权 → 401。
	const fusionKey = process.env.FUSION_API_KEY;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	if (fusionKey) return "firstParty";
	// ANTHROPIC_API_KEY only counts if it's a valid Anthropic key (sk-ant-)
	if (isAnthropicApiKey(anthropicKey)) {
		return "firstParty";
	}
	// FUSION_BASE_URL 指向非 Anthropic host → 第三方 proxy 直连 (推断, 优先级最低)
	if (hasThirdPartyProxyConfigured()) {
		return "firstParty";
	}
	return "firstParty";
}

export function isFusionMlxProvider(model?: string): boolean {
	return getAPIProvider(model) === "fusionMlx";
}

export function shouldAutoUseFusionMlx(): boolean {
	if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) return false;
	// #221: 显式本地 opt-in 先于 key 检查 — key 选凭证不选拓扑。
	if (
		isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) ||
		isEnvTruthy(process.env.FUSION_MLX_ENABLED)
	)
		return true;
	// API key 优先：用户已配置 FUSION_API_KEY（+ FUSION_BASE_URL）即直连云端，
	// 即使 baseUrl 指向 localhost（第三方网关常见）也不自动切到本地 MLX。
	// 修复：此前 localhost 检查在 key 检查之前，劫持了已配 key 的会话。
	if (process.env.FUSION_API_KEY || process.env.ANTHROPIC_API_KEY) {
		return false;
	}
	if (isEnvTruthy(process.env.FUSION_MLX_AUTO)) {
		return !process.env.FUSION_API_KEY && !process.env.ANTHROPIC_API_KEY;
	}
	const baseUrl =
		process.env.FUSION_BASE_URL || process.env.ANTHROPIC_BASE_URL || "";
	if (
		baseUrl.includes("localhost") ||
		baseUrl.includes("127.0.0.1") ||
		baseUrl.includes("::1")
	) {
		return true;
	}
	if (!process.env.FUSION_API_KEY && !process.env.ANTHROPIC_API_KEY) {
		return true;
	}
	return false;
}

export function isCloudFreeMode(): boolean {
	return getAPIProvider() === "fusionMlx";
}

export function isCloudFreeModeForModel(model?: string): boolean {
	return getAPIProvider(model) === "fusionMlx";
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
	return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
}

export function isFirstPartyAnthropicBaseUrl(): boolean {
	// audit-0902 P1-1: must read the SAME source as resolveFirstPartyBaseUrl()
	// (seam.ts) — FUSION_BASE_URL || ANTHROPIC_BASE_URL. Previously this read
	// ONLY FUSION_BASE_URL, so setting only ANTHROPIC_BASE_URL=https://attacker
	// left firstParty=true while the request went to the attacker host,
	// leaking x-api-key + OAuth Bearer. Both unset => canonical Anthropic.
	const baseUrl = process.env.FUSION_BASE_URL || process.env.ANTHROPIC_BASE_URL;
	if (!baseUrl) {
		return true;
	}
	try {
		const host = new URL(baseUrl).host;
		const allowedHosts = ["api.anthropic.com"];
		if (process.env.USER_TYPE === "ant") {
			allowedHosts.push("api-staging.anthropic.com");
		}
		return allowedHosts.includes(host);
	} catch {
		return false;
	}
}

const FALLBACK_CHAIN: Record<string, string> = {
	"claude-opus-4-8": "claude-sonnet-5",
	"claude-opus-4-7": "claude-sonnet-5",
	"claude-opus-4-6": "claude-sonnet-5",
	"claude-sonnet-5": "claude-haiku-4-5-20251001",
	"claude-sonnet-4-7": "claude-haiku-4-5-20251001",
	"claude-sonnet-4-6": "claude-haiku-4-5-20251001",
	"claude-sonnet-4-5": "claude-haiku-4-5-20251001",
};

export function getDefaultFallbackModel(
	model: string | undefined,
): string | undefined {
	if (!model) return undefined;
	const lower = model.toLowerCase();
	for (const [prefix, fallback] of Object.entries(FALLBACK_CHAIN)) {
		if (lower.includes(prefix)) {
			return fallback;
		}
	}
	return undefined;
}

export function resolveFallbackModel(
	mainModel: string | undefined,
): string | undefined {
	const envFallback = process.env.FUSION_FALLBACK_MODEL;
	if (envFallback && envFallback !== mainModel) {
		return envFallback;
	}
	return getDefaultFallbackModel(mainModel);
}
