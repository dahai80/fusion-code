// LLM 接缝 — 主循环接入函数
//
// Phase 4: claude.ts 在 withRetry 回调里, 若 LLM_ADAPTER_SEAM 开启, 调用本函数替代
// anthropic.beta.messages.create({stream:true})。本函数接收已构造好的 Anthropic
// params (paramsFromContext 产出), 直接 POST /v1/messages 并把 SSE -> StreamChunk
// -> SDK part, 返回与 Stream<BetaRawMessageStreamEvent> 结构兼容的异步迭代器。
//
// flag 关时 claude.ts 不调用本函数, 走 SDK; 回滚=关 flag。

import { feature } from "bun:bundle";
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

// 接缝是否激活 (feature 宏用三元判定, Bun DCE 允许)。
export function isSeamActive(model?: string): boolean {
	return feature("LLM_ADAPTER_SEAM")
		? getAPIProvider(model) === "firstParty" ||
				getAPIProvider(model) === "fusionMlx"
		: false;
}

// 核心: 用接缝层流式请求, 返回 SDK part 异步流。
// params 为 Anthropic /v1/messages 请求体 (已含 stream:true 或不要求; 本函数强制 stream)。
export async function* streamViaSeam(
	params: Record<string, unknown>,
	signal: AbortSignal,
	model: string,
): AsyncIterable<SdkPart> {
	const provider = getAPIProvider(model);
	const body = JSON.stringify({ ...params, stream: true });

	let baseUrl: string;
	let apiKey: string | undefined;
	let firstParty = false;
	let fetchFn: typeof fetch | undefined;

	if (provider === "fusionMlx") {
		baseUrl = MLX_PLACEHOLDER_BASE;
		fetchFn = createFusionMlxFetch(model);
	} else {
		baseUrl = resolveFirstPartyBaseUrl();
		apiKey = getAnthropicApiKey() ?? undefined;
		firstParty = isFirstPartyAnthropicBaseUrl();
	}

	const { response } = await postMessages({
		baseUrl,
		body,
		apiKey,
		firstParty,
		signal,
		fetchFn,
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

	yield* chunkStreamToSdkParts(chunks);
}
