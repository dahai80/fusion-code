import Anthropic from "@anthropic-ai/sdk";
import type { ClientOptions } from "src/types/anthropic-protocol.js";

import { randomUUID } from "crypto";
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
import {
	getAPIProvider,
	isFirstPartyAnthropicBaseUrl,
	isFusionMlxProvider,
} from "src/utils/model/providers.js";
import { getProxyFetchOptions } from "src/utils/proxy.js";
import {
	getIsNonInteractiveSession,
	getSessionId,
} from "../../bootstrap/state.js";
import { getOauthConfig } from "../../constants/oauth.js";
import { isDebugToStdErr, logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import {
	getBedrockConfig,
	isBedrockProvider,
} from "../../utils/model/bedrock.js";
import { getVertexConfig, isVertexProvider } from "../../utils/model/vertex.js";
// codex-fetch-adapter removed - cloud-only

/**
 * Fusion-MLX 客户端接口。
 * 当使用 fusion-mlx 提供商时，返回一个兼容的客户端对象。
 */
export interface FusionMlxClient {
	type: "fusionMlx";
	baseUrl: string;
	defaultModel: string | null;
	availableModels: Array<{
		id: string;
		max_input_tokens?: number;
		max_output_tokens?: number;
	}>;
}

/**
 * Environment variables for different client types:
 *
 * Direct API:
 * - FUSION_API_KEY: Required for direct API access
 *
 * AWS Bedrock:
 * - AWS credentials configured via aws-sdk defaults
 * - AWS_REGION or AWS_DEFAULT_REGION: Sets the AWS region for all models (default: us-east-1)
 * - FUSION_SMALL_FAST_MODEL_AWS_REGION: Optional. Override AWS region specifically for the small fast model (Haiku)
 *
 * Foundry (Azure):
 * - FUSION_FOUNDRY_RESOURCE: Your Azure resource name (e.g., 'my-resource')
 *   For the full endpoint: https://{resource}.services.ai.azure.com/anthropic/v1/messages
 * - FUSION_FOUNDRY_BASE_URL: Optional. Alternative to resource - provide full base URL directly
 *   (e.g., 'https://my-resource.services.ai.azure.com')
 *
 * Authentication (one of the following):
 * - FUSION_FOUNDRY_API_KEY: Your Microsoft Foundry API key (if using API key auth)
 * - Azure AD authentication: If no API key is provided, uses DefaultAzureCredential
 *   which supports multiple auth methods (environment variables, managed identity,
 *   Azure CLI, etc.). See: https://docs.microsoft.com/en-us/javascript/api/@azure/identity
 *
 * Vertex AI:
 * - Model-specific region variables (highest priority):
 *   - VERTEX_REGION_CLAUDE_3_5_HAIKU: Region for Claude 3.5 Haiku model
 *   - VERTEX_REGION_CLAUDE_HAIKU_4_5: Region for Claude Haiku 4.5 model
 *   - VERTEX_REGION_CLAUDE_3_5_SONNET: Region for Claude 3.5 Sonnet model
 *   - VERTEX_REGION_CLAUDE_3_7_SONNET: Region for Claude 3.7 Sonnet model
 * - CLOUD_ML_REGION: Optional. The default GCP region to use for all models
 *   If specific model region not specified above
 * - FUSION_VERTEX_PROJECT_ID: Required. Your GCP project ID
 * - Standard GCP credentials configured via google-auth-library
 *
 * Priority for determining region:
 * 1. Hardcoded model-specific environment variables
 * 2. Global CLOUD_ML_REGION variable
 * 3. Default region from config
 * 4. Fallback region (us-east5)
 */

function createStderrLogger(): ClientOptions["logger"] {
	return {
		error: (msg, ...args) =>
			// biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
			console.error("[Anthropic SDK ERROR]", msg, ...args),
		// biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
		warn: (msg, ...args) => console.error("[Anthropic SDK WARN]", msg, ...args),
		// biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
		info: (msg, ...args) => console.error("[Anthropic SDK INFO]", msg, ...args),
		debug: (msg, ...args) =>
			// biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
			console.error("[Anthropic SDK DEBUG]", msg, ...args),
	};
}

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
}): Promise<Anthropic> {
	const containerId = process.env.FUSION_CODE_CONTAINER_ID;
	console.error(model + " isFusionMlx=" + isFusionMlxProvider(model));
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
		const { checkFusionMlxHealth, getRecommendedCodeModel } = await import(
			"./fusion-mlx-adapter.js"
		);
		const status = await checkFusionMlxHealth();
		if (!status.available) {
			throw new Error(
				"Fusion-MLX service unavailable. Ensure fusion-mlx is running (default: http://127.0.0.1:11434)\n" +
					"Set FUSION_MLX_DISABLED=1 to disable.",
			);
		}

		const fusionMlxModel =
			process.env.FUSION_MLX_MODEL ||
			(await getRecommendedCodeModel()) ||
			"default";

		const { createFusionMlxFetch, getMlxModelCapabilities } = await import(
			"./fusion-mlx-adapter.js"
		);

		// Pre-cache model capabilities before creating fetch interceptor
		try {
			await getMlxModelCapabilities(fusionMlxModel);
		} catch (_e) {
			/* best effort */
		}
		const mlxFetch = createFusionMlxFetch(fusionMlxModel);

		const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
			apiKey: "fusion-mlx-local",
			defaultHeaders,
			maxRetries,
			timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
			dangerouslyAllowBrowser: true,
			fetch: mlxFetch as unknown as typeof globalThis.fetch,
			...(isDebugToStdErr() && { logger: createStderrLogger() }),
		};
		return new Anthropic(clientConfig);
	}

	// ── 云端提供商：需要 OAuth / API Key 认证 ──
	logForDebugging("[API:auth] OAuth token check starting");
	await checkAndRefreshOAuthTokenIfNeeded();
	logForDebugging("[API:auth] OAuth token check complete");

	if (!isClaudeAISubscriber()) {
		await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession());
	}

	const resolvedFetch = buildFetch(fetchOverride, source);

	const ARGS = {
		defaultHeaders,
		maxRetries,
		timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
		dangerouslyAllowBrowser: true,
		fetchOptions: getProxyFetchOptions({
			forAnthropicAPI: true,
		}) as ClientOptions["fetchOptions"],
		...(resolvedFetch && {
			fetch: resolvedFetch,
		}),
	};
	if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
		const { AnthropicFoundry } = await import("@anthropic-ai/foundry-sdk");
		// Determine Azure AD token provider based on configuration
		// SDK reads FUSION_FOUNDRY_API_KEY by default
		let azureADTokenProvider: (() => Promise<string>) | undefined;
		if (!process.env.FUSION_FOUNDRY_API_KEY) {
			if (isEnvTruthy(process.env.FUSION_CODE_SKIP_FOUNDRY_AUTH)) {
				// Mock token provider for testing/proxy scenarios (similar to Vertex mock GoogleAuth)
				azureADTokenProvider = () => Promise.resolve("");
			} else {
				// Use real Azure AD authentication with DefaultAzureCredential
				const {
					DefaultAzureCredential: AzureCredential,
					getBearerTokenProvider,
				} = await import("@azure/identity");
				azureADTokenProvider = getBearerTokenProvider(
					new AzureCredential(),
					"https://cognitiveservices.azure.com/.default",
				);
			}
		}

		const foundryArgs: ConstructorParameters<typeof AnthropicFoundry>[0] = {
			...ARGS,
			...(azureADTokenProvider && { azureADTokenProvider }),
			...(isDebugToStdErr() && { logger: createStderrLogger() }),
		};
		// we have always been lying about the return type - this doesn't support batching or models
		return new AnthropicFoundry(foundryArgs) as unknown as Anthropic;
	}

	// ── Bedrock provider ──
	if (isBedrockProvider()) {
		const bedrockConfig = getBedrockConfig();
		if (!bedrockConfig) {
			throw new Error(
				"Bedrock provider selected but configuration is missing. Set AWS_REGION and ensure AWS credentials are available.",
			);
		}
		try {
			const { AnthropicBedrock } = await import("@anthropic-ai/bedrock-sdk");
			const bedrockArgs: ConstructorParameters<typeof AnthropicBedrock>[0] = {
				...(ARGS as any), // log: widen ARGS type for bedrock constructor compat
				...(bedrockConfig.profile && { awsProfile: bedrockConfig.profile }),
				...(isDebugToStdErr() && { logger: createStderrLogger() }),
			};
			logForDebugging(
				`[API:bedrock] Creating Bedrock client: region=${bedrockConfig.region}, model=${bedrockConfig.modelId}`,
			);
			return new AnthropicBedrock(bedrockArgs) as unknown as Anthropic;
		} catch (importError) {
			throw new Error(
				"Bedrock SDK not installed. Run: bun add @anthropic-ai/bedrock-sdk\n" +
					"Or set FUSION_CODE_USE_BEDROCK=0 to disable.",
			);
		}
	}

	// ── Vertex provider ──
	if (isVertexProvider()) {
		const vertexConfig = getVertexConfig();
		if (!vertexConfig || !vertexConfig.projectId) {
			throw new Error(
				"Vertex provider selected but project ID is missing. Set GOOGLE_CLOUD_PROJECT.",
			);
		}
		try {
			const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
			const vertexArgs: ConstructorParameters<typeof AnthropicVertex>[0] = {
				...ARGS,
				projectId: vertexConfig.projectId,
				region: vertexConfig.region,
				...(isDebugToStdErr() && { logger: createStderrLogger() }),
			};
			logForDebugging(
				`[API:vertex] Creating Vertex client: project=${vertexConfig.projectId}, region=${vertexConfig.region}`,
			);
			return new AnthropicVertex(vertexArgs) as unknown as Anthropic;
		} catch (importError) {
			throw new Error(
				"Vertex SDK not installed. Run: bun add @anthropic-ai/vertex-sdk\n" +
					"Or set FUSION_CODE_USE_VERTEX=0 to disable.",
			);
		}
	}
	// Codex provider removed - cloud-only

	// Determine authentication method based on available tokens
	const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
		apiKey: isClaudeAISubscriber() ? null : apiKey || getAnthropicApiKey(),
		authToken: isClaudeAISubscriber()
			? getClaudeAIOAuthTokens()?.accessToken
			: undefined,
		// Set baseURL from OAuth config when using staging OAuth
		...(process.env.USER_TYPE === "ant" &&
		isEnvTruthy(process.env.USE_STAGING_OAUTH)
			? { baseURL: getOauthConfig().BASE_API_URL }
			: {}),
		...ARGS,
		...(isDebugToStdErr() && { logger: createStderrLogger() }),
	};

	return new Anthropic(clientConfig);
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

function buildFetch(
	fetchOverride: ClientOptions["fetch"],
	source: string | undefined,
): ClientOptions["fetch"] {
	// eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
	const inner = fetchOverride ?? globalThis.fetch;
	// Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
	// and unknown headers risk rejection by strict proxies (inc-4029 class).
	const injectClientRequestId =
		getAPIProvider() === "firstParty" && isFirstPartyAnthropicBaseUrl();
	return async (input, init) => {
		// eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
		const headers = new Headers(init?.headers);
		if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
			headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID());
		}

		let body = init?.body;
		try {
			// eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
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
