// LLM adapter seam — main-loop integration functions
//
// claude.ts calls streamViaSeam inside its withRetry callback, replacing
// anthropic.beta.messages.create({stream:true}). This function receives the
// already-built Anthropic params (produced by paramsFromContext), directly
// POSTs /v1/messages, and converts SSE -> StreamChunk -> SDK part, returning
// { stream, requestId, response } (stream is structurally compatible with
// Stream<BetaRawMessageStreamEvent>). The SDK has been fully removed; the
// seam is the only LLM path.

import { getSessionId } from "../../bootstrap/state.js";
import type { SdkFetch } from "../../types/anthropic-protocol.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import {
	getAPIProvider,
	isFirstPartyAnthropicBaseUrl,
} from "../../utils/model/providers.js";
import {
	captureOtelStreamUsage,
	endOtelSpan,
	isOtelTracingEnabled,
	type OtelStreamUsage,
	otelUsageAttrs,
	startOtelSpan,
} from "../../utils/telemetry/otelTracing.js";
import { createFusionMlxFetch } from "../api/fusion-mlx-adapter.js";
import { type SseState, sseToChunk } from "./adapter.js";
import { chunkStreamToSdkParts, type SdkPart } from "./chunkToPart.js";
import { postMessages } from "./httpClient.js";
import { parseSseStream } from "./sseStream.js";
import type { StreamChunk } from "./types.js";

// Placeholder baseUrl: the MLX override intercepts via
// url.includes("/v1/messages").
const MLX_PLACEHOLDER_BASE = "http://fusion-mlx.local";

function resolveFirstPartyBaseUrl(): string {
	return (
		process.env.FUSION_BASE_URL ||
		process.env.ANTHROPIC_BASE_URL ||
		"https://api.anthropic.com"
	);
}

// Resolve the seam endpoint (baseUrl/apiKey/firstParty/fetchFn), shared by
// streamViaSeam and createSeamClient.
// provider is inferred from the model: fusionMlx uses the MLX override fetch,
// everything else direct-connects as firstParty.
export function resolveSeamEndpoint(model: string): {
	baseUrl: string;
	apiKey?: string;
	firstParty: boolean;
	fetchFn?: SdkFetch;
} {
	const provider = getAPIProvider(model);
	if (provider === "fusionMlx") {
		return {
			baseUrl: MLX_PLACEHOLDER_BASE,
			firstParty: false,
			fetchFn: createFusionMlxFetch(model) as SdkFetch,
		};
	}
	return {
		baseUrl: resolveFirstPartyBaseUrl(),
		apiKey: getAnthropicApiKey() ?? undefined,
		firstParty: isFirstPartyAnthropicBaseUrl(),
	};
}

// Core: stream the request through the seam layer, return an async stream of
// SDK parts.
// params is the Anthropic /v1/messages request body (may or may not already
// carry stream:true; this function forces stream).
// extraHeaders: tracking headers (session-id/x-app etc.), injected into
// postMessages' extraHeaders.
export type SeamStreamResult = {
	stream: AsyncIterable<SdkPart>;
	requestId?: string;
	response: Response;
};

// Returns { stream, requestId, response }:
//   - stream: async iterator of SDK parts, structurally compatible with
//     Stream<BetaRawMessageStreamEvent>
//   - requestId / response: for the caller (claude.ts) to fill
//     streamRequestId/streamResponse, preserving the old SDK .withResponse()
//     request_id tracking and body-cancellation capability.
export async function streamViaSeam(
	params: Record<string, unknown>,
	signal: AbortSignal,
	model: string,
	extraHeaders?: Record<string, string>,
): Promise<SeamStreamResult> {
	const body = JSON.stringify({ ...params, stream: true });
	const { baseUrl, apiKey, firstParty, fetchFn } = resolveSeamEndpoint(model);

	const { response, requestId } = await postMessages({
		baseUrl,
		body,
		apiKey,
		firstParty,
		signal,
		fetchFn,
		extraHeaders,
	});
	if (!response.body) {
		throw new Error("streamViaSeam: response body missing");
	}

	// SSE -> StreamChunk -> SdkPart
	const state: SseState = {};
	const chunks: AsyncIterable<StreamChunk> = (async function* () {
		for await (const evt of parseSseStream(response.body, signal)) {
			const chunk = sseToChunk(evt.event, evt.data, state);
			if (chunk) yield chunk;
		}
	})();

	const sdkParts = chunkStreamToSdkParts(chunks);

	// P1.3: OTel LLM span at the single seam chokepoint — every streaming
	// caller (claude.ts main loop, LlmClient.streamMessages) gets exactly one
	// span per HTTP POST, with GenAI token usage from the stream events.
	// Default-off (FUSION_CODE_OTEL_ENDPOINT); off = passthrough, byte-identical.
	if (!isOtelTracingEnabled()) {
		return { stream: sdkParts, requestId, response };
	}
	const otelLlmSpan = startOtelSpan("gen_ai.llm", {
		"gen_ai.operation.name": "stream",
		"gen_ai.request.model": model,
		"session.id": getSessionId(),
	});
	const usage: OtelStreamUsage = {};
	const wrappedStream = (async function* () {
		try {
			for await (const part of sdkParts) {
				captureOtelStreamUsage(part, usage);
				yield part;
			}
		} finally {
			endOtelSpan(otelLlmSpan, otelUsageAttrs(usage));
		}
	})();

	return {
		stream: wrappedStream,
		requestId,
		response,
	};
}
