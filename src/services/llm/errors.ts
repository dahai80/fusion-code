// LLM seam — provider-neutral error classification (reference: dsh classifyPiAiError)
//
// Replaces the instanceof APIError checks in src/services/api/errors.ts / withRetry.ts.
// Classifies fetch exceptions and HTTP non-2xx into stable LlmFailure.code; withRetry uses it to decide retries.

import { logForDebugging } from "../../utils/debug.js";
import type { LlmErrorCode, LlmFailure } from "./types.js";

// Infers a stable error code from the HTTP status code + error message.
export function classifyByStatus(status: number): LlmErrorCode {
	if (status === 401 || status === 403) return "AUTH";
	if (status === 429 || status === 529) return "RATE_LIMIT";
	if (status === 400) return "INVALID_REQUEST";
	if (status >= 500) return "SERVER";
	return "INVALID_REQUEST";
}

// audit 2.2.1 (CRITICAL): MLX deterministic error detection. Retrying these errors always reproduces them (missing
// model/VRAM/context are hard config/resource limits); the old classification treated them as SERVER and retried 10×, a self-inflicted DoS on the shared MLX service.
// On hit → UNKNOWN (not retryable), taking priority over the status 5xx SERVER verdict.
// Signal strings taken from actual fusion-mlx/MLX OOM/kv-cache/model error logs:
//   "memory limit exceeded" (MLX OOM)
//   "Reduce context size" / "reduce the context" (context limit exceeded)
//   "model not found" / "model_not_found" (model missing/mistyped)
//   "not enough memory" / "out of memory" (system-level OOM)
//   "No space left on device" (disk full, deterministic)
export function isDeterministicError(message: string): boolean {
	return (
		/memory limit exceeded/i.test(message) ||
		/reduce (?:the )?context size/i.test(message) ||
		/model[_ ]not[_ ]found/i.test(message) ||
		/not enough memory/i.test(message) ||
		/out of memory/i.test(message) ||
		/no space left on device/i.test(message)
	);
}

// Infers a transport-layer error code from the Error instance name/message (when there is no HTTP status).
export function classifyByMessage(message: string): LlmErrorCode {
	// audit 2.2.1: deterministic errors take priority — even if the message contains "500" or the like, OOM/model_not_found
	// are not retryable and must be intercepted before the SERVER/fallback verdicts.
	if (isDeterministicError(message)) return "UNKNOWN";
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
	// P3-14: only match exact abort messages, not /abort/i — the latter falsely matches non-abort scenarios containing the
	// "abort" substring such as "aborted by operator" or "abortion policy" → misclassified as ABORTED and not retried.
	// The reliable abort signal is .name === "AbortError" (already checked in classifyError); this fallback only accepts
	// exact message strings known to come from fetch/AbortController.
	if (
		message === "Request was aborted." ||
		message === "The user aborted a request." ||
		message === "This operation was aborted." ||
		message === "The operation was aborted." ||
		message === "operation was aborted"
	)
		return "ABORTED";
	// audit 2.2.1 (CRITICAL): the fallback no longer reports SERVER. An unmatched message cannot prove the error is a retryable
	// transient one; the old `return "SERVER"` let any unrecognized error (deterministic ones included) be retried 10×.
	// Classify as UNKNOWN, no retry — fail-visible, letting upper layers classify explicitly instead of retrying by default.
	return "UNKNOWN";
}

// Unified entry point: classifies any exception + optional HTTP status into an LlmFailure.
export function classifyError(
	error: unknown,
	status?: number,
	requestId?: string,
	headers?: LlmFailure["headers"],
): LlmFailure {
	const message =
		error instanceof Error ? error.message : String(error ?? "unknown error");

	// Abort takes priority (AbortError is not retryable, and status is meaningless).
	// Compatible with DOMException and any Error with .name set to "AbortError" (fetch/AbortController convention).
	// P3-14: message checks go through exact known abort strings (same change as in classifyByMessage), not the broad
	// /abort/i match — prevents non-abort errors containing the "abort" substring (e.g. "aborted by operator") from being misjudged as non-retryable.
	if (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error as { name?: string })?.name === "AbortError" ||
		message === "Request was aborted." ||
		message === "The user aborted a request." ||
		message === "This operation was aborted." ||
		message === "The operation was aborted." ||
		message === "operation was aborted"
	) {
		return { code: "ABORTED", message, requestId };
	}

	let code: LlmErrorCode;
	// audit 2.2.1 (CRITICAL): deterministic errors take priority over status codes. MLX returns OOM / context limit /
	// model_not_found / disk-full as 500; status>=400 would hit classifyByStatus(500)→SERVER and judge deterministic
	// errors retryable. Check message first: on a deterministic signal hit → UNKNOWN, no retry, bypassing the status verdict.
	if (isDeterministicError(message)) {
		code = "UNKNOWN";
	} else if (typeof status === "number" && status >= 400) {
		code = classifyByStatus(status);
	} else {
		code = classifyByMessage(message);
	}
	// P1-7 (audit 0901): explicit logging of the error classification basis — especially the fallback UNKNOWN (a generic
	// Error without status lands in the conservative non-retryable class) and message-based classification (no status, guessing by shape),
	// making the retry-vs-throw decision point traceable instead of silently misjudged.
	if (
		code === "UNKNOWN" ||
		(typeof status !== "number" && code !== "ABORTED")
	) {
		logForDebugging(
			`[llm:errors] classifyError code=${code} status=${
				status ?? "none"
			} byMessage=${typeof status !== "number"} msg="${message.slice(0, 200)}"`,
			{ level: "warn" },
		);
	}

	// Provider Retry-After header (seconds) converted to ms; only meaningful for RATE_LIMIT
	let providerRetryAfterMs: number | undefined;
	if (code === "RATE_LIMIT") {
		providerRetryAfterMs = extractRetryAfterMs(error);
	}

	return { code, message, status, providerRetryAfterMs, requestId, headers };
}

// Retryable codes: rate limit / server error / transport / timeout. AUTH/INVALID_REQUEST/ABORTED are not retried.
export function isRetryable(failure: LlmFailure): boolean {
	return (
		failure.code === "RATE_LIMIT" ||
		failure.code === "SERVER" ||
		failure.code === "TRANSPORT" ||
		failure.code === "TIMEOUT"
	);
}

// Throws an LlmFailure as an Error carrying a code, so try/catch sites can recover it via classifyError.
// Exposes the SDK-compatible shape (.status/.headers/.requestID) so the existing
// error.status / error.headers?.get(...) reads in withRetry/errors also work on the seam path (no need to change those read sites).
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

// ── duck-typing bridge (replaces instanceof APIError / APIConnectionError / APIUserAbortError) ──
// Accepts both the SDK-thrown APIError (client path when the flag is off) and the seam-thrown LlmRequestError
// (HTTP path when the flag is on). Judged by shape rather than prototype chain, as the two error classes share no base class.

// Any error carrying .status (number) — covers SDK APIError and LlmRequestError.
// P2-7: no longer returns true for "any object with headers" — axios/got/custom errors all have headers,
// which misclassifies non-API errors as API errors → wrong retry/recovery. Requires an API-specific signal:
// status (always present on HTTP errors) or requestID (injected by SDK/seam). headers alone is insufficient.
export function isApiErrorLike(error: unknown): error is {
	status?: number;
	message: string;
	headers?: { get?(name: string): string | null };
	requestID?: string;
} {
	if (!(error instanceof Error)) return false;
	return (
		typeof (error as { status?: unknown }).status === "number" ||
		(error as { requestID?: unknown }).requestID !== undefined
	);
}

// Transport error: SDK APIConnectionError (name contains "Connection") or LlmRequestError(code=TRANSPORT/TIMEOUT).
export function isConnectionErrorLike(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return (
			error.failure.code === "TRANSPORT" || error.failure.code === "TIMEOUT"
		);
	}
	const name = (error as { name?: string }).name ?? "";
	return /Connection/.test(name);
}

// Transport + timeout: SDK APIConnectionTimeoutError (name contains "Timeout") or message contains timeout.
export function isTimeoutErrorLike(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return error.failure.code === "TIMEOUT";
	}
	const name = (error as { name?: string }).name ?? "";
	// P1-22: match "timed out" (Node "Request timed out") too, not just the
	// contiguous "timeout" token. A timed-out request that fails the regex
	// is misclassified as non-timeout and never triggers retry/recovery.
	return /Timeout/.test(name) || /timeout|timed?\s*out/i.test(error.message);
}

// Abort: SDK APIUserAbortError (name "APIUserAbortError") or any .name === "AbortError",
// or LlmRequestError(code=ABORTED), or a DOMException thrown by a fetch AbortSignal.
export function isAbortErrorLike(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error instanceof LlmRequestError) {
		return error.failure.code === "ABORTED";
	}
	const name = (error as { name?: string }).name ?? "";
	// P3-14: exact abort message set (same source as classifyError/classifyByMessage), not /abort/i.
	return (
		name === "APIUserAbortError" ||
		name === "AbortError" ||
		error.message === "Request was aborted." ||
		error.message === "The user aborted a request." ||
		error.message === "This operation was aborted." ||
		error.message === "The operation was aborted." ||
		error.message === "operation was aborted"
	);
}

// Detects Retry-After (seconds) on an Error. Adapters/httpClient may attach _retryAfterSec to the error.
function extractRetryAfterMs(error: unknown): number | undefined {
	const sec = (error as { _retryAfterSec?: number })?._retryAfterSec;
	if (typeof sec === "number" && sec >= 0) {
		return Math.round(sec * 1000);
	}
	return undefined;
}
