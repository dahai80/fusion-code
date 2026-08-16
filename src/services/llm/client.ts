// LLM 接缝 — provider-neutral 客户端
//
// 替代 anthropic.beta.messages.create / countTokens / models.list 的调用形态:
//   - streaming: anthropic.beta.messages.create({stream:true}) -> Stream<BetaRawMessageStreamEvent>
//   - non-streaming: anthropic.beta.messages.create(...) -> BetaMessage
//   - count_tokens: anthropic.beta.messages.countTokens(...) -> { input_tokens }
//   - models.list: anthropic.models.list({betas}) -> 迭代模型条目
//   - raw response: anthropic.beta.messages.create(...).asResponse() -> 原始 Response (读限流头)
// 本客户端用接缝层 (postMessages + 直接 fetch) 复刻全部, 不经 @anthropic-ai/sdk。
//
// claude.ts / client.ts (api) 改为持有 LlmClient, 调 streamMessages()/createMessage() 等。
// firstParty+fusionMlx 由 createSeamClient 构造; bedrock/vertex/foundry 在 client.ts 抛错
// 引导走 fusion-gateway。

import type { SdkFetch } from "../../types/anthropic-protocol.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import { logForDebugging } from "../../utils/debug.js";
import { getUserAgent } from "../../utils/http.js";
import { getProxyFetchOptions } from "../../utils/proxy.js";
import { CLIENT_REQUEST_ID_HEADER } from "../api/client.js";
import type { SdkPart } from "./chunkToPart.js";
import { classifyError, LlmRequestError } from "./errors.js";
import { postMessages } from "./httpClient.js";
import { resolveSeamEndpoint, streamViaSeam } from "./seam.js";

// 非流式响应的最小子集 (claude.ts 实际读取的字段)。不依赖 SDK 类型, 结构兼容 BetaMessage。
export type BetaMessageLike = {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	stop_reason: string | null;
	content: Array<Record<string, unknown>>;
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
		[k: string]: unknown;
	};
	[k: string]: unknown;
};

// count_tokens 响应: { input_tokens: number; [k]: unknown }
export type CountTokensResult = {
	input_tokens: number;
	[k: string]: unknown;
};

// models.list 单条条目: { id: string; [k]: unknown }
export type ModelListEntry = {
	id: string;
	[k: string]: unknown;
};

// createMessageRaw 返回: 原始 Response + request_id (读限流头/_request_id 用)。
export type RawMessageResult = {
	response: Response;
	requestId?: string;
};

// 流式/非流式公共请求选项。signal 可选 (verify_api_key 等无中断上下文)。
export interface MessageRequestOpts {
	signal?: AbortSignal;
	timeoutMs?: number;
	headers?: Record<string, string>;
}

export interface LlmClient {
	// 流式: 返回与 BetaRawMessageStreamEvent 结构兼容的 SdkPart 异步流。
	streamMessages(
		params: Record<string, unknown>,
		opts: {
			signal: AbortSignal;
			headers?: Record<string, string>;
			requestId?: string;
		},
	): AsyncIterable<SdkPart>;
	// 非流式: POST /v1/messages (stream:false), 返回 BetaMessage 形状对象。
	createMessage(
		params: Record<string, unknown>,
		opts: MessageRequestOpts,
	): Promise<BetaMessageLike>;
	// 非流式原始响应: POST /v1/messages (stream:false), 返回 Response + request_id。
	// 用于读取限流头 (claudeAiLimits 的 asResponse() 路径)。
	createMessageRaw(
		params: Record<string, unknown>,
		opts: MessageRequestOpts,
	): Promise<RawMessageResult>;
	// 计数: POST /v1/messages/count_tokens, 返回 { input_tokens }。
	countTokens(
		params: Record<string, unknown>,
		opts?: MessageRequestOpts,
	): Promise<CountTokensResult>;
	// 模型列表: GET /v1/models, 异步迭代模型条目。
	listModels(opts?: {
		betas?: string[];
		signal?: AbortSignal;
	}): AsyncIterable<ModelListEntry>;
}

// firstParty + fusionMlx 的接缝客户端。streamMessages 复用 streamViaSeam;
// createMessage/createMessageRaw/countTokens/listModels 直接 fetch 并解析。
// defaultHeaders (session-id/x-app/custom 等) 经 extraHeaders 注入每个请求, 保持与
// 旧 SDK 客户端的追踪头一致。
export function createSeamClient(
	model: string,
	fetchOverride?: SdkFetch,
	defaultHeaders?: Record<string, string>,
): LlmClient {
	// 合并每个方法的特定 headers 与全局 defaultHeaders (方法 headers 优先)。
	const mergeHeaders = (
		methodHeaders?: Record<string, string>,
	): Record<string, string> | undefined => {
		if (!defaultHeaders) return methodHeaders;
		if (!methodHeaders) return { ...defaultHeaders };
		return { ...defaultHeaders, ...methodHeaders };
	};
	return {
		async *streamMessages(params, opts) {
			// 委托给既有接缝流 (claude.ts 主流式路径)。
			// streamViaSeam 返回 { stream, requestId, response }; 这里只转发 stream 部分,
			// requestId/response 由 claude.ts 直接调 streamViaSeam 时自行取用。
			const seam = await streamViaSeam(
				params,
				opts.signal,
				model,
				mergeHeaders(opts.headers),
			);
			yield* seam.stream;
		},

		async createMessage(params, opts) {
			const ep = resolveSeamEndpoint(model);
			const body = JSON.stringify({ ...params, stream: false });
			logForDebugging(
				`[llm:client] createMessage model=${model} baseUrl=${ep.baseUrl}`,
			);
			const { response, requestId } = await postMessages({
				baseUrl: ep.baseUrl,
				body,
				apiKey: ep.apiKey,
				firstParty: ep.firstParty,
				signal: opts.signal,
				timeoutMs: opts.timeoutMs,
				fetchFn: fetchOverride ?? ep.fetchFn,
				extraHeaders: mergeHeaders(opts.headers),
			});
			let json: unknown;
			try {
				json = await response.json();
			} catch (error) {
				console.error(
					`[llm:client] createMessage body parse failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				throw new Error("createMessage: response body is not valid JSON");
			}
			// 注入 _request_id, 复刻 SDK response._request_id 约定 (sideQuery 等读取)。
			const msg = json as BetaMessageLike;
			if (requestId) {
				(msg as Record<string, unknown>)._request_id = requestId;
			}
			return msg;
		},

		async createMessageRaw(params, opts) {
			const ep = resolveSeamEndpoint(model);
			const body = JSON.stringify({ ...params, stream: false });
			logForDebugging(
				`[llm:client] createMessageRaw model=${model} baseUrl=${ep.baseUrl}`,
			);
			const { response, requestId } = await postMessages({
				baseUrl: ep.baseUrl,
				body,
				apiKey: ep.apiKey,
				firstParty: ep.firstParty,
				signal: opts.signal,
				timeoutMs: opts.timeoutMs,
				fetchFn: fetchOverride ?? ep.fetchFn,
				extraHeaders: mergeHeaders(opts.headers),
			});
			// asResponse() 语义: 调用方负责读取 body/headers, 此处不消费 body。
			return { response, requestId };
		},

		async countTokens(params, opts) {
			const ep = resolveSeamEndpoint(model);
			const url = joinUrl(ep.baseUrl, "/v1/messages/count_tokens");
			const body = JSON.stringify(params);
			logForDebugging(
				`[llm:client] countTokens model=${model} baseUrl=${ep.baseUrl}`,
			);
			const json = await rawFetchJson({
				url,
				method: "POST",
				body,
				apiKey: ep.apiKey,
				firstParty: ep.firstParty,
				signal: opts?.signal,
				timeoutMs: opts?.timeoutMs,
				extraHeaders: mergeHeaders(opts?.headers),
				betas: extractBetas(params),
				fetchFn: fetchOverride ?? ep.fetchFn,
			});
			return json as CountTokensResult;
		},

		async *listModels(opts) {
			const ep = resolveSeamEndpoint(model);
			const url = joinUrl(ep.baseUrl, "/v1/models?limit=1000");
			logForDebugging(
				`[llm:client] listModels model=${model} baseUrl=${ep.baseUrl}`,
			);
			const json = await rawFetchJson({
				url,
				method: "GET",
				apiKey: ep.apiKey,
				firstParty: ep.firstParty,
				signal: opts?.signal,
				betas: opts?.betas,
				extraHeaders: mergeHeaders(),
				fetchFn: fetchOverride ?? ep.fetchFn,
			});
			// /v1/models 返回 { data: ModelEntry[], has_more, ... }
			const data = (json as { data?: unknown }).data;
			if (Array.isArray(data)) {
				for (const entry of data) {
					if (entry && typeof entry === "object" && "id" in entry) {
						yield entry as ModelListEntry;
					}
				}
			}
		},
	};
}

// ── 内部辅助 ──────────────────────────────────────────────

function extractBetas(params: Record<string, unknown>): string[] | undefined {
	const b = params.betas;
	if (Array.isArray(b) && b.length > 0) {
		return b.filter((x) => typeof x === "string") as string[];
	}
	return undefined;
}

interface RawFetchOpts {
	url: string;
	method: "GET" | "POST";
	body?: string;
	apiKey?: string;
	firstParty?: boolean;
	signal?: AbortSignal;
	timeoutMs?: number;
	extraHeaders?: Record<string, string>;
	betas?: string[];
	fetchFn?: SdkFetch;
}

async function rawFetchJson(opts: RawFetchOpts): Promise<unknown> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"user-agent": getUserAgent(),
		"anthropic-version": "2023-06-01",
	};
	if (opts.apiKey) {
		headers["x-api-key"] = opts.apiKey;
	} else if (opts.firstParty) {
		const key = getAnthropicApiKey();
		if (key) headers["x-api-key"] = key;
	}
	if (opts.firstParty) {
		headers[CLIENT_REQUEST_ID_HEADER] = crypto.randomUUID();
	}
	if (opts.betas && opts.betas.length > 0) {
		headers["anthropic-beta"] = opts.betas.join(",");
	}
	if (opts.extraHeaders) {
		for (const [k, v] of Object.entries(opts.extraHeaders)) {
			headers[k.toLowerCase()] = v;
		}
	}
	const fetchOptions: RequestInit & { dispatcher?: unknown; timeout?: number } =
		{
			method: opts.method,
			headers,
			...(opts.body !== undefined && { body: opts.body }),
			...(opts.signal && { signal: opts.signal }),
			...getProxyFetchOptions({ forAnthropicAPI: true }),
		};
	if (opts.timeoutMs) {
		fetchOptions.timeout = opts.timeoutMs;
	}
	const doFetch = opts.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await doFetch(opts.url, fetchOptions as RequestInit);
	} catch (error) {
		const failure = classifyError(error, undefined, undefined);
		logForDebugging(
			`[llm:client] ${opts.method} ${opts.url} fetch failed: ${failure.code} ${failure.message}`,
		);
		throw new LlmRequestError(failure);
	}
	if (!response.ok) {
		const requestId = response.headers.get("request-id") ?? undefined;
		let statusText = "";
		try {
			statusText = await response.text();
		} catch {
			// 读 body 失败忽略
		}
		const wrapped: Error & { _retryAfterSec?: number } = new Error(
			`${response.status} ${response.statusText}: ${statusText}`,
		);
		const failure = classifyError(
			wrapped,
			response.status,
			requestId,
			response.headers as unknown as Parameters<typeof classifyError>[3],
		);
		logForDebugging(
			`[llm:client] ${opts.method} ${opts.url} non-2xx ${response.status} ${failure.code}`,
		);
		throw new LlmRequestError(failure);
	}
	let json: unknown;
	try {
		json = await response.json();
	} catch (error) {
		console.error(
			`[llm:client] ${opts.method} ${opts.url} body parse failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		throw new Error(
			`${opts.method} ${opts.url}: response body is not valid JSON`,
		);
	}
	return json;
}

function joinUrl(base: string, path: string): string {
	if (base.endsWith("/") && path.startsWith("/")) {
		return base.slice(0, -1) + path;
	}
	if (!base.endsWith("/") && !path.startsWith("/")) {
		return `${base}/${path}`;
	}
	return base + path;
}
