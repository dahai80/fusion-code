// LLM 接缝 — 主循环接入函数
//
// claude.ts 在 withRetry 回调里调用 streamViaSeam 替代
// anthropic.beta.messages.create({stream:true})。本函数接收已构造好的 Anthropic
// params (paramsFromContext 产出), 直接 POST /v1/messages 并把 SSE -> StreamChunk
// -> SDK part, 返回 { stream, requestId, response } (stream 与
// Stream<BetaRawMessageStreamEvent> 结构兼容)。SDK 已彻底移除, 接缝为唯一 LLM 路径。

import type { SdkFetch } from "../../types/anthropic-protocol.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import {
	getAPIProvider,
	isFirstPartyAnthropicBaseUrl,
} from "../../utils/model/providers.js";
import { createFusionMlxFetch } from "../api/fusion-mlx-adapter.js";
import { type SseState, sseToChunk } from "./adapter.js";
import { chunkStreamToSdkParts, type SdkPart } from "./chunkToPart.js";
import { postMessages } from "./httpClient.js";
import { parseSseStream } from "./sseStream.js";
import type { StreamChunk } from "./types.js";

// 占位 baseUrl: MLX override 按 url.includes("/v1/messages") 拦截。
const MLX_PLACEHOLDER_BASE = "http://fusion-mlx.local";

function resolveFirstPartyBaseUrl(): string {
	return (
		process.env.FUSION_BASE_URL ||
		process.env.ANTHROPIC_BASE_URL ||
		"https://api.anthropic.com"
	);
}

// 解析接缝端点 (baseUrl/apiKey/firstParty/fetchFn), streamViaSeam 与 createSeamClient 共用。
// provider 由 model 推断: fusionMlx 走 MLX override fetch, 其余按 firstParty 直连。
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

// 核心: 用接缝层流式请求, 返回 SDK part 异步流。
// params 为 Anthropic /v1/messages 请求体 (已含 stream:true 或不要求; 本函数强制 stream)。
// extraHeaders: 追踪头 (session-id/x-app 等), 注入 postMessages 的 extraHeaders。
export type SeamStreamResult = {
	stream: AsyncIterable<SdkPart>;
	requestId?: string;
	response: Response;
};

// 返回 { stream, requestId, response }:
//   - stream: 与 Stream<BetaRawMessageStreamEvent> 结构兼容的 SDK part 异步迭代器
//   - requestId / response: 供调用方 (claude.ts) 填充 streamRequestId/streamResponse,
//     保留与旧 SDK .withResponse() 一致的 request_id 追踪与 body 取消能力。
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

	return {
		stream: chunkStreamToSdkParts(chunks),
		requestId,
		response,
	};
}
