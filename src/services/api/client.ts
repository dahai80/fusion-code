import { randomUUID } from "node:crypto";
import type { ClientOptions, SdkFetch } from "src/types/anthropic-protocol.js";
import {
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
 * - FUSION_CLIENT_KEY + FUSION_BASE_URL: direct connect to any Anthropic-compatible
 *   /v1/messages endpoint (FUSION_BASE_URL defaults to api.anthropic.com)
 * - FUSION_MLX_BASE_URL / FUSION_GATEWAY_URL: local inference endpoint
 *   (default 127.0.0.1:11432), opt-in via FUSION_MLX_ENABLED=1
 *
 * Cloud providers (Bedrock / Vertex / Foundry / OpenAI):
 * - SDK removal: these signing paths are no longer bundled in-process.
 *   Point FUSION_BASE_URL at an Anthropic-compatible endpoint that performs
 *   the provider's native auth, and set FUSION_CLIENT_KEY — or keep the
 *   FUSION_CODE_USE_* vars unset to use firstParty directly.
 */

/**
 * getAnthropicClient returns a provider-neutral LlmClient (seam layer), replacing the @anthropic-ai/sdk client.
 *
 * - firstParty + fusionMlx: createSeamClient(model, fetchOverride, defaultHeaders)
 *   directly POSTs /v1/messages and translates SSE, bypassing the SDK.
 * - bedrock / vertex / foundry / openai: throws, guiding configuration of FUSION_BASE_URL +
 *   FUSION_CLIENT_KEY to connect directly to an Anthropic-compatible endpoint (cloud signing is done by that endpoint).
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
		`[API:request] Creating client, FUSION_CUSTOM_HEADERS present: ${!!process.env.FUSION_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders.Authorization}`,
	);

	// Add additional protection header if enabled via env var
	const additionalProtectionEnabled = isEnvTruthy(
		process.env.FUSION_CODE_ADDITIONAL_PROTECTION,
	);
	if (additionalProtectionEnabled) {
		defaultHeaders["x-anthropic-additional-protection"] = "true";
	}

	// ── Fusion-MLX (local) provider — explicitly opted-in local endpoint ──
	// Converged semantics (endpoint-unified): the local inference service is just
	// another Anthropic-compatible endpoint. The only way to reach this branch is
	// explicit user opt-in (FUSION_MLX_ENABLED /
	// FUSION_GATEWAY_ENABLED / FUSION_MLX_BASE_URL / FUSION_GATEWAY_URL);
	// there is no implicit entry path via startup auto-detection (removed) or
	// model-name sniffing (removed).
	if (isFusionMlxProvider(model)) {
		const {
			checkFusionMlxHealth,
			getRecommendedCodeModel,
			getMlxModelCapabilities,
			getMlxEndpointDebug,
		} = await import("./fusion-mlx-adapter.js");
		const status = await checkFusionMlxHealth();
		if (!status.available) {
			// #290: report the ACTUAL resolved endpoint, not a hardcoded default —
			// FUSION_GATEWAY_URL silently shadows FUSION_MLX_BASE_URL, and the old
			// message always claimed 11432 regardless of configuration.
			const ep = getMlxEndpointDebug();
			throw new Error(
				`Local inference service unavailable (endpoint: ${ep.url}, source: ${ep.source})\n` +
					"Precedence: FUSION_GATEWAY_URL > FUSION_MLX_BASE_URL > MLX_BASE_URL > default http://127.0.0.1:11432.\n" +
					"Set FUSION_MLX_BASE_URL / FUSION_GATEWAY_URL to override, or unset\n" +
					"FUSION_MLX_ENABLED and use FUSION_BASE_URL + FUSION_CLIENT_KEY to connect\n" +
					"to a cloud endpoint instead.",
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
		// Inside createSeamClient, resolveSeamEndpoint constructs createFusionMlxFetch.
		// fetchOverride is meaningless on the MLX path (MLX has its own fetch interception); only defaultHeaders is passed.
		return createSeamClient(fusionMlxModel, undefined, defaultHeaders);
	}

	// ── Cloud providers: SDK signing stripped; uniformly guide users to connect directly to a self-hosted/third-party endpoint ──
	// Semantics identical to firstParty: FUSION_BASE_URL points at any Anthropic-compatible
	// /v1/messages endpoint, FUSION_CLIENT_KEY is the auth key. fusion-gateway is no longer required.
	if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
		throw new Error(
			"Foundry (Azure) direct connect was removed along with @anthropic-ai/sdk.\n" +
				"Set FUSION_BASE_URL to an Anthropic-compatible endpoint and configure FUSION_CLIENT_KEY;\n" +
				"that endpoint handles Azure AD signing (or unset FUSION_CODE_USE_FOUNDRY to use firstParty).",
		);
	}
	// P0-4 (audit R6): dedicated openai branch. Previously FUSION_CODE_USE_OPENAI=1 had no dedicated
	// branch → silently fell through to firstParty below → OpenAI key/model name hit api.anthropic.com
	// (semantic mismatch, silent 401/404 failure). Explicit throw directs the user to configure a
	// direct-connect endpoint, isomorphic with bedrock/vertex/foundry. This repo does no in-process
	// OpenAI direct connect (codex-fetch-adapter dead code removed); OpenAI OAuth credentials
	// (codex-client/codex-oauth) remain for endpoint auth pass-through.
	if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) {
		throw new Error(
			"OpenAI direct connect was removed along with @anthropic-ai/sdk.\n" +
				"Set FUSION_BASE_URL to an Anthropic-compatible endpoint and configure FUSION_CLIENT_KEY;\n" +
				"that endpoint handles OpenAI (Azure/Bearer) signing (or unset FUSION_CODE_USE_OPENAI to use firstParty).",
		);
	}
	if (isBedrockProvider()) {
		throw new Error(
			"Bedrock direct connect was removed along with @anthropic-ai/bedrock-sdk.\n" +
				"Set FUSION_BASE_URL to an Anthropic-compatible endpoint and configure FUSION_CLIENT_KEY;\n" +
				"that endpoint handles AWS SigV4 signing (or unset FUSION_CODE_USE_BEDROCK to use firstParty).",
		);
	}
	if (isVertexProvider()) {
		throw new Error(
			"Vertex AI direct connect was removed along with @anthropic-ai/vertex-sdk.\n" +
				"Set FUSION_BASE_URL to an Anthropic-compatible endpoint and configure FUSION_CLIENT_KEY;\n" +
				"that endpoint handles GCP credentials (or unset FUSION_CODE_USE_VERTEX to use firstParty).",
		);
	}

	// ── firstParty (direct Anthropic API connection) ──
	logForDebugging("[API:auth] OAuth token check starting");
	logForDebugging("[API:auth] OAuth token check complete");

	if (!isClaudeAISubscriber()) {
		await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession());
	}

	// firstParty: createSeamClient uses resolveSeamEndpoint to resolve baseUrl/apiKey;
	// OAuth/API key auth headers are injected by the seam's httpClient.buildHeaders (apiKey/authToken).
	// OAuth subscribers' accessToken is passed through to the seam separately (buildHeaders only recognizes x-api-key/authorization).
	const oauthTokens = isClaudeAISubscriber()
		? getClaudeAIOAuthTokens()
		: undefined;
	if (oauthTokens?.accessToken) {
		defaultHeaders.Authorization = `Bearer ${oauthTokens.accessToken}`;
	}
	// Explicit apiKey (non-subscriber) is passed to the seam as an x-api-key fallback.
	const seamApiKey = isClaudeAISubscriber()
		? undefined
		: apiKey || getAnthropicApiKey();
	if (seamApiKey) {
		defaultHeaders["x-api-key"] = seamApiKey;
	}

	// staging OAuth baseURL pass-through: the seam reads FUSION_BASE_URL/ANTHROPIC_BASE_URL via resolveSeamEndpoint.
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
	// resolvedFetch is injected into the seam as fetchOverride (cch signing + request-id logging).
	// Note: the seam's httpClient already has cch signing and CLIENT_REQUEST_ID injection; resolvedFetch
	// here mainly serves to pass through fetchOverride (test injection); duplicate cch/request-id is dominated by httpClient.
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
		headers.Authorization = `Bearer ${token}`;
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

// buildFetch: passes through fetchOverride and injects CLIENT_REQUEST_ID/cch signing logs.
// After SDK removal, the seam's httpClient has built-in cch/CLIENT_REQUEST_ID; this function mainly
// serves fetchOverride (test) injection and request-path logging, kept for existing-call compatibility.
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

// Keep the ClientOptions type export for compatibility (some legacy callers still type-reference it). After SDK removal this type is locally defined.
export type { ClientOptions };
