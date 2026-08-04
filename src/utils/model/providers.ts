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

export function getAPIProvider(model?: string): APIProvider {
	if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
		if (isEnvTruthy(process.env.FUSION_CODE_USE_BEDROCK)) return "bedrock";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_VERTEX)) return "vertex";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) return "foundry";
		if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) return "openai";
		return "firstParty";
	}
	if (isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) || isEnvTruthy(process.env.FUSION_MLX_ENABLED)) {
		return "fusionMlx";
	}
	// If the model name is clearly an MLX model, use fusionMlx regardless of API keys
	if (isMlxModelName(model)) {
		return "fusionMlx";
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
	// Check FUSION_API_KEY first — it's the canonical key for this CLI
	const fusionKey = process.env.FUSION_API_KEY;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	// If FUSION_API_KEY is set, use firstParty (it maps to ANTHROPIC_API_KEY in cli.tsx)
	if (fusionKey) return "firstParty";
	// ANTHROPIC_API_KEY only counts if it's a valid Anthropic key (sk-ant-)
	// OR if a third-party proxy base URL is configured (FUSION_BASE_URL → non-Anthropic host)
	// A stale/invalid ANTHROPIC_API_KEY without proxy config should fall through to MLX
	if (isAnthropicApiKey(anthropicKey) || hasThirdPartyProxyConfigured()) {
		return "firstParty";
	}
	return "fusionMlx";
}

export function isFusionMlxProvider(model?: string): boolean {
	return getAPIProvider(model) === "fusionMlx";
}

export function shouldAutoUseFusionMlx(): boolean {
	if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) return false;
	if (isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) || isEnvTruthy(process.env.FUSION_MLX_ENABLED)) return true;
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
	const baseUrl = process.env.FUSION_BASE_URL;
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
