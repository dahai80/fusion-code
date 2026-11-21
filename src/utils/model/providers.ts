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
	// #221 topology semantics: the key selects credentials, not topology. An explicit local opt-in
	// (FUSION_MLX_ENABLED / FUSION_GATEWAY_ENABLED / FUSION_MLX_BASE_URL /
	// FUSION_GATEWAY_URL) is a clear deployment fact and must not be overridden by the mere
	// presence of FUSION_CLIENT_KEY — local users who configured the canonical key per the docs
	// would otherwise be silently pulled back to cloud firstParty (the other half of the live 401 repro root cause).
	if (
		isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) ||
		isEnvTruthy(process.env.FUSION_MLX_ENABLED) ||
		process.env.FUSION_MLX_BASE_URL ||
		process.env.FUSION_GATEWAY_URL
	) {
		return "fusionMlx";
	}
	// Canonical config: FUSION_BASE_URL + FUSION_CLIENT_KEY (+ FUSION_MODEL) →
	// firstParty direct connect. The API key takes precedence over all inference — the client does not guess
	// where the user's LLM runs (protocol-compatible = direct connect); but an explicit opt-in is stated
	// intent and ranks before the key check.
	// Fix (401 root cause): isMlxModelName() model-name sniffing previously ranked before the key check;
	// when FUSION_MODEL was an MLX-style name it hijacked key-configured sessions onto the local adapter,
	// authenticating with the wrong credential system (FUSION_GATEWAY_API_KEY) → 401.
	const fusionKey = process.env.FUSION_CLIENT_KEY;
	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	if (fusionKey) return "firstParty";
	// ANTHROPIC_API_KEY only counts if it's a valid Anthropic key (sk-ant-)
	if (isAnthropicApiKey(anthropicKey)) {
		return "firstParty";
	}
	// FUSION_BASE_URL pointing at a non-Anthropic host → third-party proxy direct connect (inference, lowest priority)
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
	// #221: explicit local opt-in ranks before the key check — the key selects credentials, not topology.
	if (
		isEnvTruthy(process.env.FUSION_GATEWAY_ENABLED) ||
		isEnvTruthy(process.env.FUSION_MLX_ENABLED)
	)
		return true;
	// API key takes precedence: once the user has configured FUSION_CLIENT_KEY (+ FUSION_BASE_URL), connect
	// directly to the cloud; even if baseUrl points at localhost (common for third-party gateways), do not
	// auto-switch to local MLX.
	// Fix: the localhost check previously ranked before the key check, hijacking key-configured sessions.
	if (process.env.FUSION_CLIENT_KEY || process.env.ANTHROPIC_API_KEY) {
		return false;
	}
	if (isEnvTruthy(process.env.FUSION_MLX_AUTO)) {
		return !process.env.FUSION_CLIENT_KEY && !process.env.ANTHROPIC_API_KEY;
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
	if (!process.env.FUSION_CLIENT_KEY && !process.env.ANTHROPIC_API_KEY) {
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
