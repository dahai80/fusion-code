// LLM 接缝 — provider 中立错误分类 (参考 dsh classifyPiAiError)
//
// 替代 src/services/api/errors.ts / withRetry.ts 中的 instanceof APIError 判定。
// 把 fetch 异常与 HTTP 非 2xx 归为稳定 LlmFailure.code, withRetry 据此判重试。

import type { LlmFailure, LlmErrorCode } from "./types.js";

// 从 HTTP 状态码 + 错误信息推断稳定错误码。
export function classifyByStatus(status: number): LlmErrorCode {
    if (status === 401 || status === 403) return "AUTH";
    if (status === 429 || status === 529) return "RATE_LIMIT";
    if (status === 400) return "INVALID_REQUEST";
    if (status >= 500) return "SERVER";
    return "INVALID_REQUEST";
}

// 从 Error 实例名/信息推断传输层错误码 (无 HTTP 状态时)。
export function classifyByMessage(message: string): LlmErrorCode {
    if (/\b401\b|\b403\b|unauthor|forbidden|invalid.*api.*key/i.test(message))
        return "AUTH";
    if (/\b429\b|rate.?limit|too many requests/i.test(message)) return "RATE_LIMIT";
    if (/\b400\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";
    if (/\b5\d\d\b|internal server|bad gateway|service unavail/i.test(message))
        return "SERVER";
    if (/timeout|timed?\s*out/i.test(message)) return "TIMEOUT";
    if (
        /(?:network|connection|socket|fetch|econn\w*|terminated|premature close|other side closed)/i.test(
            message,
        )
    )
        return "TRANSPORT";
    if (/abort/i.test(message)) return "ABORTED";
    return "SERVER";
}

// 统一入口: 把任意异常 + 可选 HTTP 状态归为 LlmFailure。
export function classifyError(
    error: unknown,
    status?: number,
    requestId?: string,
): LlmFailure {
    const message =
        error instanceof Error ? error.message : String(error ?? "unknown error");

    // 中断优先 (AbortError 不可重试, 且 status 无意义)。
    // 兼容 DOMException 与任意把 .name 设为 "AbortError" 的 Error (fetch/AbortController 约定)。
    if (
        (error instanceof DOMException && error.name === "AbortError") ||
        (error as { name?: string })?.name === "AbortError" ||
        /abort/i.test(message)
    ) {
        return { code: "ABORTED", message, requestId };
    }

    let code: LlmErrorCode;
    if (typeof status === "number" && status >= 400) {
        code = classifyByStatus(status);
    } else {
        code = classifyByMessage(message);
    }

    // provider Retry-After 头 (秒) 转 ms, 仅对 RATE_LIMIT 有意义
    let providerRetryAfterMs: number | undefined;
    if (code === "RATE_LIMIT") {
        providerRetryAfterMs = extractRetryAfterMs(error);
    }

    return { code, message, status, providerRetryAfterMs, requestId };
}

// 可重试码: 限流 / 服务端错误 / 传输层 / 超时。AUTH/INVALID_REQUEST/ABORTED 不重试。
export function isRetryable(failure: LlmFailure): boolean {
    return (
        failure.code === "RATE_LIMIT" ||
        failure.code === "SERVER" ||
        failure.code === "TRANSPORT" ||
        failure.code === "TIMEOUT"
    );
}

// 把 LlmFailure 抛出为一个带 code 的 Error, 供 try/catch 处再 classifyError 还原。
export class LlmRequestError extends Error {
    readonly failure: LlmFailure;
    constructor(failure: LlmFailure) {
        super(failure.message);
        this.name = "LlmRequestError";
        this.failure = failure;
    }
}

// 从 Error 上探测 Retry-After (秒)。适配器/httpClient 可在 error 上挂 _retryAfterSec。
function extractRetryAfterMs(error: unknown): number | undefined {
    const sec = (error as { _retryAfterSec?: number })?._retryAfterSec;
    if (typeof sec === "number" && sec >= 0) {
        return Math.round(sec * 1000);
    }
    return undefined;
}
