// LLM 接缝 — provider 中立错误分类 (参考 dsh classifyPiAiError)
//
// 替代 src/services/api/errors.ts / withRetry.ts 中的 instanceof APIError 判定。
// 把 fetch 异常与 HTTP 非 2xx 归为稳定 LlmFailure.code, withRetry 据此判重试。

import type { LlmErrorCode, LlmFailure } from "./types.js";

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
	if (/\b429\b|rate.?limit|too many requests/i.test(message))
		return "RATE_LIMIT";
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
	headers?: LlmFailure["headers"],
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

	return { code, message, status, providerRetryAfterMs, requestId, headers };
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
// 暴露 SDK 兼容形态 (.status/.headers/.requestID), 使 withRetry/errors 既有的
// error.status / error.headers?.get(...) 读取对 seam 路径同样生效 (无需改那些读取点)。
export class LlmRequestError extends Error {
	readonly failure: LlmFailure;
	readonly status?: number;
	readonly headers?: LlmFailure["headers"];
	readonly requestID?: string;
	constructor(failure: LlmFailure) {
		super(failure.message);
		this.name = "LlmRequestError";
		this.failure = failure;
		this.status = failure.status;
		this.headers = failure.headers;
		this.requestID = failure.requestId;
	}
}

// ── duck-typing 桥 (替代 instanceof APIError / APIConnectionError / APIUserAbortError) ──
// 同时接纳 SDK 抛出的 APIError (flag 关时客户端路径) 与 seam 抛出的 LlmRequestError
// (flag 开时 HTTP 路径)。判定靠形态而非原型链, 因两类错误无共同基类。

// 任意带 .status (number) 的错误 — 覆盖 SDK APIError 与 LlmRequestError。
export function isApiErrorLike(error: unknown): error is {
	status?: number;
	message: string;
	headers?: { get?(name: string): string | null };
	requestID?: string;
} {
	if (!(error instanceof Error)) return false;
	return (
		typeof (error as { status?: unknown }).status === "number" ||
		(error as { headers?: unknown }).headers !== undefined ||
		(error as { requestID?: unknown }).requestID !== undefined
	);
}

// 传输层错误: SDK APIConnectionError (name 含 "Connection") 或 LlmRequestError(code=TRANSPORT/TIMEOUT)。
export function isConnectionErrorLike(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return (
			error.failure.code === "TRANSPORT" ||
			error.failure.code === "TIMEOUT"
		);
	}
	const name = (error as { name?: string }).name ?? "";
	return /Connection/.test(name);
}

// 传输层 + 超时: SDK APIConnectionTimeoutError (name 含 "Timeout") 或 message 含 timeout。
export function isTimeoutErrorLike(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return error.failure.code === "TIMEOUT";
	}
	const name = (error as { name?: string }).name ?? "";
	return /Timeout/.test(name) || /timeout/i.test(error.message);
}

// 中断: SDK APIUserAbortError (name "APIUserAbortError") 或任意 .name === "AbortError",
// 或 LlmRequestError(code=ABORTED), 或 fetch AbortSignal 抛出的 DOMException。
export function isAbortErrorLike(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return error.failure.code === "ABORTED";
	}
	const name = (error as { name?: string }).name ?? "";
	return (
		name === "APIUserAbortError" ||
		name === "AbortError" ||
		error.message === "Request was aborted."
	);
}

// 从 Error 上探测 Retry-After (秒)。适配器/httpClient 可在 error 上挂 _retryAfterSec。
function extractRetryAfterMs(error: unknown): number | undefined {
	const sec = (error as { _retryAfterSec?: number })?._retryAfterSec;
	if (typeof sec === "number" && sec >= 0) {
		return Math.round(sec * 1000);
	}
	return undefined;
}
