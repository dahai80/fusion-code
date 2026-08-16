import { randomUUID } from "crypto";
import type { ClientOptions, SdkFetch } from "src/types/anthropic-protocol.js";
import {
	checkAndRefreshOAuthTokenIfNeeded,
	getAnthropicApiKey,
	getApiKeyFromApiKeyHelper,
	getClaudeAIOAuthTokens,
	isClaudeAISubscriber,
} from "src/utils/auth.js";
import {
	computeCch,
	hasCchPlaceholder,
	replaceCchPlaceholder,
} from "src/utils/cch.js";
import { getUserAgent } from "src/utils/http.js";
import { isBedrockProvider } from "src/utils/model/bedrock.js";
import {
	getAPIProvider,
	isFirstPartyAnthropicBaseUrl,
	isFusionMlxProvider,
} from "src/utils/model/providers.js";
import { isVertexProvider } from "src/utils/model/vertex.js";
import {
	getIsNonInteractiveSession,
	getSessionId,
} from "../../bootstrap/state.js";
import { getOauthConfig } from "../../constants/oauth.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { createSeamClient, type LlmClient } from "../llm/client.js";

/**
 * Environment variables for different client types:
 *
 * Direct API (firstParty) / Fusion-MLX (local):
 * - FUSION_API_KEY: Required for direct API access
 * - FUSION_GATEWAY_URL / FUSION_MLX_BASE_URL: local inference endpoint (default 127.0.0.1:11432)
 *
 * Cloud providers (Bedrock / Vertex / Foundry):
 * - SDK removal: these signing paths are no longer bundled in-process.
 *   Route them through fusion-gateway (https) which speaks the provider's
 *   native auth and exposes an Anthropic-compatible /v1/messages endpoint.
 *   Set FUSION_GATEWAY_URL to the gateway and FUSION_GATEWAY_ENABLED=1, or
 *   keep FUSION_CODE_USE_BEDROCK/VERTEX/FOUNDRY unset to fall back to firstParty.
 */

/**
 * getAnthropicClient 返回 provider-neutral LlmClient (接缝层), 取代 @anthropic-ai/sdk 客户端。
 *
 * - firstParty + fusionMlx: createSeamClient(model, fetchOverride, defaultHeaders)
 *   直接 POST /v1/messages 并 SSE 翻译, 不经 SDK。
 * - bedrock / vertex / foundry: 抛错, 引导走 fusion-gateway (云端签名在网关完成)。
 */
export async function getAnthropicClient({
	apiKey,
	maxRetries,
	model,
	fetchOverride,
	source,
}: {
	apiKey?: string;
	maxRetries: number;
	model?: string;
	fetchOverride?: ClientOptions["fetch"];
	source?: string;
}): Promise<LlmClient> {
	const containerId = process.env.FUSION_CODE_CONTAINER_ID;
	console.error(
		`${model ?? "(no-model)"} isFusionMlx=${isFusionMlxProvider(model)}`,
	);
	const remoteSessionId = process.env.FUSION_CODE_REMOTE_SESSION_ID;
	const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP;
	const customHeaders = getCustomHeaders();
	const defaultHeaders: { [key: string]: string } = {
		"x-app": "cli",
		"User-Agent": getUserAgent(),
		"X-Claude-Code-Session-Id": getSessionId(),
		...customHeaders,
		...(containerId ? { "x-claude-remote-container-id": containerId } : {}),
		...(remoteSessionId
			? { "x-claude-remote-session-id": remoteSessionId }
			: {}),
		// SDK consumers can identify their app/library for backend analytics
		...(clientApp ? { "x-client-app": clientApp } : {}),
	};

	// Log API client configuration for HFI debugging
	logForDebugging(
		`[API:request] Creating client, FUSION_CUSTOM_HEADERS present: ${!!process.env.FUSION_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders["Authorization"]}`,
	);

	// Add additional protection header if enabled via env var
	const additionalProtectionEnabled = isEnvTruthy(
		process.env.FUSION_CODE_ADDITIONAL_PROTECTION,
	);
	if (additionalProtectionEnabled) {
		defaultHeaders["x-anthropic-additional-protection"] = "true";
	}

	// ── Fusion-MLX (local) provider — skip all cloud auth ──
	if (isFusionMlxProvider(model)) {
		// 等待启动时的 fire-and-forget MLX 检测完成
		const mlxReady = (globalThis as any).__fusionMlxReady as
			| Promise<boolean>
			| undefined;
		if (mlxReady) {
			await mlxReady;
		}
		const {
			checkFusionMlxHealth,
			getRecommendedCodeModel,
			getMlxModelCapabilities,
		} = await import("./fusion-mlx-adapter.js");
		const status = await checkFusionMlxHealth();
		if (!status.available) {
			throw new Error(
				"Fusion-MLX service unavailable. Ensure gateway is running (default: http://127.0.0.1:11432)\n" +
					"Set FUSION_GATEWAY_URL to override or FUSION_MLX_DISABLED=1 to disable.",
			);
		}

		const fusionMlxModel =
			process.env.FUSION_MLX_MODEL ||
			(await getRecommendedCodeModel()) ||
			"default";

		// Pre-cache model capabilities before creating fetch interceptor
		try {
			await getMlxModelCapabilities(fusionMlxModel);
		} catch (_e) {
			/* best effort */
		}
		logForDebugging(
			`[API:fusion-mlx] seam client model=${fusionMlxModel} maxRetries=${maxRetries} source=${source ?? "unknown"}`,
		);
		// createSeamClient 内部 resolveSeamEndpoint 会构造 createFusionMlxFetch。
		// fetchOverride 在 MLX 路径下无意义 (MLX 自带 fetch 拦截), 仅传 defaultHeaders。
		return createSeamClient(fusionMlxModel, undefined, defaultHeaders);
	}

	// ── 云端提供商：需要 OAuth / API Key 认证 ──
	// Bedrock / Vertex / Foundry 的 SDK 签名已剥离, 统一引导走 fusion-gateway。
	if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
		throw new Error(
			"Foundry (Azure) 直连已随 @anthropic-ai/sdk 一并移除。\n" +
				"请改用 fusion-gateway: 设置 FUSION_GATEWAY_URL 指向网关并 FUSION_GATEWAY_ENABLED=1,\n" +
				"网关负责 Azure AD 签名并以 Anthropic 兼容接口暴露 /v1/messages。",
		);
	}
	if (isBedrockProvider()) {
		throw new Error(
			"Bedrock 直连已随 @anthropic-ai/bedrock-sdk 一并移除。\n" +
				"请改用 fusion-gateway: 设置 FUSION_GATEWAY_URL 指向网关并 FUSION_GATEWAY_ENABLED=1,\n" +
				"网关负责 AWS SigV4 签名并以 Anthropic 兼容接口暴露 /v1/messages。",
		);
	}
	if (isVertexProvider()) {
		throw new Error(
			"Vertex AI 直连已随 @anthropic-ai/vertex-sdk 一并移除。\n" +
				"请改用 fusion-gateway: 设置 FUSION_GATEWAY_URL 指向网关并 FUSION_GATEWAY_ENABLED=1,\n" +
				"网关负责 GCP 凭据并以 Anthropic 兼容接口暴露 /v1/messages。",
		);
	}

	// ── firstParty (Anthropic API 直连) ──
	logForDebugging("[API:auth] OAuth token check starting");
	await checkAndRefreshOAuthTokenIfNeeded();
	logForDebugging("[API:auth] OAuth token check complete");

	if (!isClaudeAISubscriber()) {
		await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession());
	}

	// firstParty: createSeamClient 用 resolveSeamEndpoint 解析 baseUrl/apiKey,
	// OAuth/API key 鉴权头由 seam 的 httpClient.buildHeaders 注入 (apiKey/authToken)。
	// OAuth 订阅用户的 accessToken 单独透传给 seam (buildHeaders 仅认 x-api-key/authorization)。
	const oauthTokens = isClaudeAISubscriber()
		? getClaudeAIOAuthTokens()
		: undefined;
	if (oauthTokens?.accessToken) {
		defaultHeaders["Authorization"] = `Bearer ${oauthTokens.accessToken}`;
	}
	// 显式 apiKey (非订阅) 传给 seam 作为 x-api-key 兜底。
	const seamApiKey = isClaudeAISubscriber()
		? undefined
		: apiKey || getAnthropicApiKey();
	if (seamApiKey) {
		defaultHeaders["x-api-key"] = seamApiKey;
	}

	// staging OAuth baseURL 透传: seam 经 resolveSeamEndpoint 读 FUSION_BASE_URL/ANTHROPIC_BASE_URL。
	if (
		process.env.USER_TYPE === "ant" &&
		isEnvTruthy(process.env.USE_STAGING_OAUTH)
	) {
		process.env.FUSION_BASE_URL =
			process.env.FUSION_BASE_URL || getOauthConfig().BASE_API_URL;
	}

	const resolvedFetch = buildFetch(fetchOverride, source);
	logForDebugging(
		`[API:firstParty] seam client model=${model ?? "(default)"} maxRetries=${maxRetries} source=${source ?? "unknown"}`,
	);
	// resolvedFetch 作为 fetchOverride 注入 seam (cch 签名 + request-id 日志)。
	// 注: seam 的 httpClient 已自带 cch 签名与 CLIENT_REQUEST_ID 注入, resolvedFetch
	// 在此主要用于透传 fetchOverride (测试注入), 重复的 cch/request-id 由 httpClient 主导。
	return createSeamClient(
		model ?? "",
		resolvedFetch as SdkFetch | undefined,
		defaultHeaders,
	);
}

async function configureApiKeyHeaders(
	headers: Record<string, string>,
	isNonInteractiveSession: boolean,
): Promise<void> {
	const token =
		process.env.FUSION_AUTH_TOKEN ||
		(await getApiKeyFromApiKeyHelper(isNonInteractiveSession));
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}
}

function getCustomHeaders(): Record<string, string> {
	const customHeaders: Record<string, string> = {};
	const customHeadersEnv = process.env.FUSION_CUSTOM_HEADERS;

	if (!customHeadersEnv) return customHeaders;

	// Split by newlines to support multiple headers
	const headerStrings = customHeadersEnv.split(/\n|\r\n/);

	for (const headerString of headerStrings) {
		if (!headerString.trim()) continue;

		// Parse header in format "Name: Value" (curl style). Split on first `:`
		// then trim — avoids regex backtracking on malformed long header lines.
		const colonIdx = headerString.indexOf(":");
		if (colonIdx === -1) continue;
		const name = headerString.slice(0, colonIdx).trim();
		const value = headerString.slice(colonIdx + 1).trim();
		if (name) {
			customHeaders[name] = value;
		}
	}

	return customHeaders;
}

export const CLIENT_REQUEST_ID_HEADER = "x-client-request-id";

// buildFetch: 透传 fetchOverride 并注入 CLIENT_REQUEST_ID/cch 签名日志。
// SDK 移除后, seam 的 httpClient 自带 cch/CLIENT_REQUEST_ID, 本函数主要用于
// fetchOverride (测试) 注入与请求路径日志, 保留以兼容既有调用。
function buildFetch(
	fetchOverride: ClientOptions["fetch"] | undefined,
	source: string | undefined,
): SdkFetch | undefined {
	const inner = fetchOverride ?? globalThis.fetch;
	// Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
	// and unknown headers risk rejection by strict proxies (inc-4029 class).
	const injectClientRequestId =
		getAPIProvider() === "firstParty" && isFirstPartyAnthropicBaseUrl();
	return async (input, init) => {
		const headers = new Headers(init?.headers);
		if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
			headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID());
		}

		let body = init?.body;
		try {
			const url = input instanceof Request ? input.url : String(input);
			const id = headers.get(CLIENT_REQUEST_ID_HEADER);
			logForDebugging(
				`[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ""} source=${source ?? "unknown"}`,
			);

			if (
				url.includes("/v1/messages") &&
				headers.has("anthropic-version") &&
				typeof body === "string" &&
				hasCchPlaceholder(body)
			) {
				const cch = await computeCch(body);
				body = replaceCchPlaceholder(body, cch);
				logForDebugging(`[CCH] signed request cch=${cch}`);
			}
		} catch {
			// never let logging crash the fetch
		}
		return inner(input, { ...init, headers, body });
	};
}

// 保留 ClientOptions 类型导出兼容 (部分旧调用仍以类型引用)。SDK 移除后该类型为本地定义。
export type { ClientOptions };
