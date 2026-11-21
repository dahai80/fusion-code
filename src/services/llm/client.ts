// LLM adapter seam — provider-neutral client
//
// Replaces the call shapes of anthropic.beta.messages.create / countTokens /
// models.list:
//   - streaming: anthropic.beta.messages.create({stream:true}) -> Stream<BetaRawMessageStreamEvent>
//   - non-streaming: anthropic.beta.messages.create(...) -> BetaMessage
//   - count_tokens: anthropic.beta.messages.countTokens(...) -> { input_tokens }
//   - models.list: anthropic.models.list({betas}) -> iterate model entries
//   - raw response: anthropic.beta.messages.create(...).asResponse() -> raw Response (read rate-limit headers)
// This client replicates all of it via the seam layer (postMessages + direct
// fetch), bypassing @anthropic-ai/sdk.
//
// claude.ts / client.ts (api) now hold an LlmClient and call
// streamMessages()/createMessage() etc.
// firstParty+fusionMlx are constructed by createSeamClient;
// bedrock/vertex/foundry/openai throw in client.ts, directing users to
// configure FUSION_BASE_URL + FUSION_CLIENT_KEY for direct connect to an
// Anthropic-compatible endpoint.

import { getSessionId } from "../../bootstrap/state.js";
import type { SdkFetch } from "../../types/anthropic-protocol.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import { logForDebugging } from "../../utils/debug.js";
import { getUserAgent } from "../../utils/http.js";
import { getProxyFetchOptions } from "../../utils/proxy.js";
// P1.3: OTel GenAI trace chain (default-off, FUSION_CODE_OTEL_ENDPOINT)
import {
	endOtelSpan,
	otelUsageAttrs,
	startOtelSpan,
} from "../../utils/telemetry/otelTracing.js";
import { CLIENT_REQUEST_ID_HEADER } from "../api/client.js";
import type { SdkPart } from "./chunkToPart.js";
import { classifyError, LlmRequestError } from "./errors.js";
import { postMessages } from "./httpClient.js";
import { resolveSeamEndpoint, streamViaSeam } from "./seam.js";

// Minimal subset of the non-streaming response (fields claude.ts actually
// reads). No SDK type dependency, structurally compatible with BetaMessage.
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

// count_tokens response: { input_tokens: number; [k]: unknown }
export type CountTokensResult = {
	input_tokens: number;
	[k: string]: unknown;
};

// Single models.list entry: { id: string; [k]: unknown }
export type ModelListEntry = {
	id: string;
	[k: string]: unknown;
};

// createMessageRaw returns: raw Response + request_id (for reading
// rate-limit headers / _request_id).
export type RawMessageResult = {
	response: Response;
	requestId?: string;
};

// Common request options for streaming/non-streaming. signal is optional
// (verify_api_key etc. have no interruption context).
export interface MessageRequestOpts {
	signal?: AbortSignal;
	timeoutMs?: number;
	headers?: Record<string, string>;
}

export interface LlmClient {
	// Streaming: returns an async stream of SdkParts structurally compatible
	// with BetaRawMessageStreamEvent.
	streamMessages(
		params: Record<string, unknown>,
		opts: {
			signal: AbortSignal;
			headers?: Record<string, string>;
			requestId?: string;
		},
	): AsyncIterable<SdkPart>;
	// Non-streaming: POST /v1/messages (stream:false), returns a
	// BetaMessage-shaped object.
	createMessage(
		params: Record<string, unknown>,
		opts: MessageRequestOpts,
	): Promise<BetaMessageLike>;
	// Non-streaming raw response: POST /v1/messages (stream:false), returns
	// Response + request_id.
	// For reading rate-limit headers (claudeAiLimits' asResponse() path).
	createMessageRaw(
		params: Record<string, unknown>,
		opts: MessageRequestOpts,
	): Promise<RawMessageResult>;
	// Count: POST /v1/messages/count_tokens, returns { input_tokens }.
	countTokens(
		params: Record<string, unknown>,
		opts?: MessageRequestOpts,
	): Promise<CountTokensResult>;
	// Model list: GET /v1/models, async-iterates model entries.
	listModels(opts?: {
		betas?: string[];
		signal?: AbortSignal;
	}): AsyncIterable<ModelListEntry>;
}

// Seam client for firstParty + fusionMlx. streamMessages reuses
// streamViaSeam; createMessage/createMessageRaw/countTokens/listModels fetch
// and parse directly.
// defaultHeaders (session-id/x-app/custom etc.) are injected into every
// request via extraHeaders, keeping tracking headers consistent with the old
// SDK client.
export function createSeamClient(
	model: string,
	fetchOverride?: SdkFetch,
	defaultHeaders?: Record<string, string>,
): LlmClient {
	// Merge per-method specific headers with the global defaultHeaders
	// (method headers win).
	const mergeHeaders = (
		methodHeaders?: Record<string, string>,
	): Record<string, string> | undefined => {
		if (!defaultHeaders) return methodHeaders;
		if (!methodHeaders) return { ...defaultHeaders };
		return { ...defaultHeaders, ...methodHeaders };
	};
	return {
		async *streamMessages(params, opts) {
			// Delegate to the existing seam stream (claude.ts main streaming
			// path).
			// streamViaSeam returns { stream, requestId, response }; only the
			// stream part is forwarded here, requestId/response are consumed by
			// claude.ts when it calls streamViaSeam directly.
			// P1.3: streaming LLM span is instrumented centrally in
			// streamViaSeam (single choke point).
			const seam = await streamViaSeam(
				params,
				opts.signal,
				model,
				mergeHeaders(opts.headers),
			);
			yield* seam.stream;
		},

		async createMessage(params, opts) {
			const otelLlmSpan = startOtelSpan("gen_ai.llm", {
				"gen_ai.operation.name": "create",
				"gen_ai.request.model": model,
				"session.id": getSessionId(),
			});
			let extra: Record<string, string | number | boolean> = {};
			try {
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
				// Inject _request_id, replicating the SDK's response._request_id
				// convention (read by sideQuery etc.).
				const msg = json as BetaMessageLike;
				if (requestId) {
					(msg as Record<string, unknown>)._request_id = requestId;
				}
				if (msg.usage) {
					extra = otelUsageAttrs({
						input: msg.usage.input_tokens,
						output: msg.usage.output_tokens,
					});
				}
				return msg;
			} catch (error) {
				extra = {
					"error.type": error instanceof Error ? error.name : "unknown",
				};
				throw error;
			} finally {
				endOtelSpan(otelLlmSpan, extra);
			}
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
			// asResponse() semantics: the caller reads body/headers; the body is not
			// consumed here.
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
			logForDebugging(
				`[llm:client] listModels model=${model} baseUrl=${ep.baseUrl}`,
			);
			// P1-6 (audit 0901): the old implementation fetched a single page with
			// limit=1000 without paginating — when upstream returned
			// has_more=true it silently truncated -> the /model list was missing
			// models and users couldn't select models that actually exist.
			// Switched to cursor pagination: Anthropic /v1/models pages with
			// after=<last_id> + has_more. A max page cap (MAX_PAGES) guards
			// against a malicious/runaway upstream paging forever; hitting the
			// cap logs prominently (not silent truncation).
			const MAX_PAGES = Number.isFinite(
				parseInt(process.env.FUSION_CODE_LISTMODELS_MAX_PAGES ?? "", 10),
			)
				? parseInt(process.env.FUSION_CODE_LISTMODELS_MAX_PAGES ?? "", 10)
				: 10;
			let page = 0;
			let afterId: string | undefined;
			let totalYielded = 0;
			let truncatedAt: number | undefined;
			while (page < MAX_PAGES) {
				page++;
				const qs = afterId
					? `/v1/models?limit=1000&after=${encodeURIComponent(afterId)}`
					: "/v1/models?limit=1000";
				const url = joinUrl(ep.baseUrl, qs);
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
				// /v1/models returns { data: ModelEntry[], has_more, last_id, ... }
				const parsed = json as {
					data?: unknown;
					has_more?: boolean;
					last_id?: string;
				};
				const data = parsed.data;
				let pageYielded = 0;
				let lastSeenId: string | undefined;
				if (Array.isArray(data)) {
					for (const entry of data) {
						if (entry && typeof entry === "object" && "id" in entry) {
							yield entry as ModelListEntry;
							pageYielded++;
							lastSeenId = (entry as { id: string }).id;
						}
					}
				}
				totalYielded += pageYielded;
				// Server's has_more + last_id explicitly signal more -> keep
				// paging; otherwise stop.
				if (!parsed.has_more || !parsed.last_id) {
					afterId = undefined;
					break;
				}
				// Prefer the server's last_id; if missing, fall back to this page's
				// last entry id as the cursor.
				afterId = parsed.last_id ?? lastSeenId;
				if (!afterId || pageYielded === 0) break; // no cursor/empty page -> stop, prevents infinite loop
				if (page >= MAX_PAGES) {
					truncatedAt = totalYielded;
				}
			}
			if (truncatedAt !== undefined) {
				// Non-silent truncation: page cap hit while has_more -> prominent
				// log so the user knows the list is incomplete.
				logForDebugging(
					`[llm:client] listModels TRUNCATED at ${truncatedAt} models (hit MAX_PAGES=${MAX_PAGES}; upstream has_more=true). Raise FUSION_CODE_LISTMODELS_MAX_PAGES to fetch all.`,
					{ level: "warn" },
				);
			}
		},
	};
}

// ── Internal helpers ──────────────────────────────────────────────

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
			// Ignore body-read failures
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
