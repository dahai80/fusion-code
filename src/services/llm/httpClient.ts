// LLM seam — minimal HTTP client (POST /v1/messages -> SSE stream)
//
// Replaces the Anthropic SDK client: direct fetch + reuse of the existing auth/proxy/cch utilities, bypassing the SDK.
// The adapter (adapter.ts) calls this to get the SSE stream, then consumes it via sseStream.parseSseStream.
//
// Reuses (does not rewrite) existing logic:
//   src/utils/http.ts      getUserAgent
//   src/utils/proxy.ts     getProxyFetchOptions
//   src/utils/auth.ts      getAnthropicApiKey
//   src/utils/cch.ts       computeCch/replaceCchPlaceholder/hasCchPlaceholder

import { randomUUID } from "node:crypto";
import type { SdkFetch } from "../../types/anthropic-protocol.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import {
	computeCch,
	hasCchPlaceholder,
	replaceCchPlaceholder,
} from "../../utils/cch.js";
import { logForDebugging } from "../../utils/debug.js";
import { getUserAgent } from "../../utils/http.js";
import { getProxyFetchOptions } from "../../utils/proxy.js";
import { CLIENT_REQUEST_ID_HEADER } from "../api/client.js";
import { classifyError, LlmRequestError } from "./errors.js";

export interface PostMessagesOptions {
	baseUrl: string;
	body: string;
	apiKey?: string;
	authToken?: string;
	extraHeaders?: Record<string, string>;
	firstParty?: boolean;
	signal?: AbortSignal;
	timeoutMs?: number;
	// Optional fetch injection (the fusion-mlx path uses createFusionMlxFetch to intercept and translate).
	// Defaults to globalThis.fetch. Typed as SdkFetch (no preconnect), compatible with both SDK fetch and injected tests.
	fetchFn?: SdkFetch;
}

export interface PostMessagesResult {
	response: Response;
	requestId?: string;
}

// POST a streaming /v1/messages request; returns the SSE Response and request_id.
// Non-2xx or fetch exception -> throws LlmRequestError (carrying LlmFailure, which withRetry uses for retry classification).
export async function postMessages(
	opts: PostMessagesOptions,
): Promise<PostMessagesResult> {
	const url = joinUrl(opts.baseUrl, "/v1/messages");
	const headers = buildHeaders(opts);
	let body = opts.body;

	// cch signing: only for firstParty direct connection
	if (opts.firstParty && hasCchPlaceholder(body)) {
		try {
			const cch = await computeCch(body);
			body = replaceCchPlaceholder(body, cch);
			logForDebugging(`[llm:http] signed request cch=${cch}`);
		} catch {
			// cch failure does not block the request (consistent with the existing buildFetch behavior)
		}
	}

	const fetchOptions: RequestInit & { dispatcher?: unknown } = {
		method: "POST",
		headers,
		body,
		signal: opts.signal,
		...getProxyFetchOptions({ forAnthropicAPI: true }),
	};
	if (opts.timeoutMs) {
		// @ts-expect-error Bun/Node fetch accepts timeout
		fetchOptions.timeout = opts.timeoutMs;
	}

	let response: Response;
	try {
		const doFetch = opts.fetchFn ?? fetch;
		response = await doFetch(url, fetchOptions as RequestInit);
	} catch (error) {
		const failure = classifyError(error, undefined, undefined);
		logForDebugging(
			`[llm:http] fetch failed: ${failure.code} ${failure.message}`,
		);
		throw new LlmRequestError(failure);
	}

	if (!response.ok) {
		const requestId = response.headers.get("request-id") ?? undefined;
		let statusText = "";
		let retryAfterSec: number | undefined;
		try {
			statusText = await response.text();
			const ra = response.headers.get("retry-after");
			if (ra) retryAfterSec = Number.parseInt(ra, 10);
		} catch {
			// Ignore body read failure
		}
		const wrapped: Error & { _retryAfterSec?: number } = new Error(
			`${response.status} ${response.statusText}: ${statusText}`,
		);
		if (Number.isFinite(retryAfterSec)) {
			wrapped._retryAfterSec = retryAfterSec;
		}
		// Keep the response headers (source of rate-limit/retry headers) so withRetry/errors' error.headers?.get(...) works.
		const failure = classifyError(
			wrapped,
			response.status,
			requestId,
			response.headers as unknown as Parameters<typeof classifyError>[3],
		);
		logForDebugging(
			`[llm:http] non-2xx ${response.status} ${failure.code} ${failure.message}`,
		);
		throw new LlmRequestError(failure);
	}

	const requestId = response.headers.get("request-id") ?? undefined;
	return { response, requestId };
}

function buildHeaders(opts: PostMessagesOptions): Record<string, string> {
	const h: Record<string, string> = {
		"content-type": "application/json",
		"user-agent": getUserAgent(),
		"anthropic-version": "2023-06-01",
	};
	if (opts.apiKey) {
		h["x-api-key"] = opts.apiKey;
	} else if (opts.authToken) {
		h.authorization = `Bearer ${opts.authToken}`;
	} else if (opts.firstParty) {
		const key = getAnthropicApiKey();
		if (key) h["x-api-key"] = key;
	}
	if (opts.firstParty) {
		h[CLIENT_REQUEST_ID_HEADER] = randomUUID();
	}
	if (opts.extraHeaders) {
		for (const [k, v] of Object.entries(opts.extraHeaders)) {
			h[k.toLowerCase()] = v;
		}
	}
	return h;
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
