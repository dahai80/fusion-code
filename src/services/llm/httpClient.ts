// LLM 接缝 — 极简 HTTP 客户端 (POST /v1/messages -> SSE 流)
//
// 替代 Anthropic SDK 客户端: 直接 fetch + 复用现有 auth/proxy/cch 工具, 不经 SDK。
// 适配器 (adapter.ts/mlxAdapter.ts) 调此函数拿到 SSE 流后, 用 sseStream.parseSseStream 消费。
//
// 复用 (不重写) 既有逻辑:
//   src/utils/http.ts      getUserAgent
//   src/utils/proxy.ts     getProxyFetchOptions
//   src/utils/auth.ts      getAnthropicApiKey
//   src/utils/cch.ts       computeCch/replaceCchPlaceholder/hasCchPlaceholder

import { randomUUID } from "node:crypto";
import {
    computeCch,
    hasCchPlaceholder,
    replaceCchPlaceholder,
} from "../../utils/cch.js";
import { getAnthropicApiKey } from "../../utils/auth.js";
import { getUserAgent } from "../../utils/http.js";
import { getProxyFetchOptions } from "../../utils/proxy.js";
import { logForDebugging } from "../../utils/debug.js";
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
    // 可选 fetch 注入 (fusion-mlx 路径用 createFusionMlxFetch 拦截并转译)。
    // 缺省走 globalThis.fetch。
    fetchFn?: typeof fetch;
}

export interface PostMessagesResult {
    response: Response;
    requestId?: string;
}

// POST 一个 /v1/messages 流式请求, 返回 SSE Response 与 request_id。
// 非 2xx 或 fetch 异常 -> 抛 LlmRequestError (携带 LlmFailure, withRetry 据此判重试)。
export async function postMessages(
    opts: PostMessagesOptions,
): Promise<PostMessagesResult> {
    const url = joinUrl(opts.baseUrl, "/v1/messages");
    const headers = buildHeaders(opts);
    let body = opts.body;

    // cch 签名: 仅 firstParty 直连时
    if (opts.firstParty && hasCchPlaceholder(body)) {
        try {
            const cch = await computeCch(body);
            body = replaceCchPlaceholder(body, cch);
            logForDebugging(`[llm:http] signed request cch=${cch}`);
        } catch {
            // cch 失败不阻断请求 (与现有 buildFetch 行为一致)
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
        // @ts-expect-error Bun/Node fetch 接受 timeout
        fetchOptions.timeout = opts.timeoutMs;
    }

    let response: Response;
    try {
        const doFetch = opts.fetchFn ?? fetch;
        response = await doFetch(url, fetchOptions as RequestInit);
    } catch (error) {
        const failure = classifyError(error, undefined, undefined);
        logForDebugging(`[llm:http] fetch failed: ${failure.code} ${failure.message}`);
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
            // 读 body 失败忽略
        }
        const wrapped: Error & { _retryAfterSec?: number } = new Error(
            `${response.status} ${response.statusText}: ${statusText}`,
        );
        if (Number.isFinite(retryAfterSec)) {
            wrapped._retryAfterSec = retryAfterSec;
        }
        const failure = classifyError(wrapped, response.status, requestId);
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
        h["authorization"] = `Bearer ${opts.authToken}`;
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
