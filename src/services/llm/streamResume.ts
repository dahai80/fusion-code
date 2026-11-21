// Stream-resume client slice (gw#123 server half; fusion-code client half).
//
// When a local MLX streaming generation drops mid-way due to a transport/timeout-class
// error (not a user abort), the client reconnects to the gateway's resume endpoint
// (GET /v1/messages/{sid}/events) carrying Last-Event-ID, merging replayed frames +
// the live tail to continue claude.ts's for-await, instead of resending the whole turn.
//
// Server contract (gw#123, read-only): config routing.stream.resume_enabled (default false)
// AND route == LocalBackend; sid = request X-Request-ID; response header X-Fusion-Stream-ID;
// every SSE frame id: <sid>:<seq> (monotonic); bounded buffer (256 events / 1MiB / 10m TTL);
// resume endpoint GET /v1/messages/{sid}/events, cursor via the Last-Event-ID header (preferred) or
// ?last_event_id=; parsed with strings.LastIndex(cursor,":")+Atoi; two-phase replay-after-cursor
// + live drain; 404 = disabled/unknown/evicted.
//
// Key problem: the cursor is lost in 3 places in the fusion-code MLX translation layer —
//   B1 transformMLXStreamToAnthropic only parses data: lines → id: is stripped
//   B2 encodeStreamToAnthropicSSE:1284 spreads the original response headers → X-Fusion-Stream-ID passes through (no change needed)
//   B3 streamViaSeam sseToChunk discards evt.id
// Solution: teeCursor extracts id: into a mutable ref via a side channel before transform; sid is read from the
// streamResponse headers (passed through by B2); resume-eligible errors (timeout-class = pipe drained, lag=0)
// reconnect in claude.ts's catch, STATE-CONTINUATION (deep-clone the pre-drop StreamState as the continuation seed)
// merges with no replayed out-of-order frames.
//
// default-off (FUSION_CODE_STREAM_RESUME_ENABLED), off = byte-identical. env-gate instead of
// feature() runtime cast (PR#9 build bug: feature() requires string literals for DCE).

import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import {
	type AnthropicStreamEvent,
	type StreamState,
	transformMLXStreamToAnthropic,
} from "../api/fusion-mlx-stream.js";
import { isTimeoutErrorLike } from "./errors.js";

// ─── Gating ─────────────────────────────────────────────────────

// Whether resume is enabled (env-gated, default-off byte-identical).
export function isStreamResumeEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_STREAM_RESUME_ENABLED);
}

// Max resume reconnect attempts per turn (default 3).
export function maxAttempts(): number {
	const raw = parseInt(
		process.env.FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS ?? "",
		10,
	);
	return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

// ─── Cursor side channel (teeCursor) ──────────────────────────────────
// B1 fix: split SSE frames before transform, extract id: <sid>:<seq> into a mutable ref,
// pass frames through to transform unchanged. When claude.ts drops, it reads ref.current for the cursor.

// Cursor ref: mutable, not written by transform/adapter; claude.ts reads the last seen id on drop.
export type CursorRef = { current: string };
// State ref: transform writes live state on every processChunk; claude.ts deep-clones it on drop.
export type StateRef = { current: StreamState | undefined };

// Split SSE frames (separated by \n\n), extract each frame's id: line into the ref, pass frames through untouched.
// Pass-through = byte-identical: transform keeps parsing only data:, behavior unchanged.
// ref.current always holds the most recently seen id (the gateway puts an id on every frame; frames without id → ref not updated).
export function teeCursor(rawResponseBody: ReadableStream<Uint8Array>): {
	ref: CursorRef;
	stream: ReadableStream<Uint8Array>;
} {
	const ref: CursorRef = { current: "" };
	const decoder = new TextDecoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = rawResponseBody.getReader();
			let buffer = "";
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					// Pass the original bytes through first (transform consumes unchanged), then extract the id on the side.
					controller.enqueue(value);
					buffer += decoder.decode(value, { stream: true });

					// Scan for id: line by line (frame-boundary independent — the gateway's id: line format is fixed "<sid>:<seq>").
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (line.startsWith("id:")) {
							ref.current = line.slice(3).trim();
						}
					}
				}
				// Handle trailing residual line
				if (buffer.startsWith("id:")) {
					ref.current = buffer.slice(3).trim();
				}
			} catch (err) {
				controller.error(err);
				return;
			}
			controller.close();
		},
		cancel(reason) {
			// When upstream (transform) cancels, pass the cancel to the original body to release resources.
			rawResponseBody.cancel(reason).catch(() => {});
		},
	});

	return { ref, stream };
}

// ─── resume GET (bypassing createFusionMlxFetch) ──────────────────
// The resume GET URL contains /v1/messages/{sid}/events, which matches the adapter's
// url.includes("/v1/messages") interceptor → would be wrongly rewritten. So use the real
// global fetch to connect directly to baseUrl.

// resume GET: real global fetch direct to baseUrl (bypasses the createFusionMlxFetch interceptor).
// Cursor Last-Event-ID header = "<sid>:<seq>" (gateway parses via LastIndex(":")+Atoi).
// Returns the resumed OpenAI-SSE Response (with id: lines, same shape as the original stream).
// 404 (disabled/evicted/TTL) / non-2xx → throws (claude.ts falls to the existing fallback).
export async function resumeStreamFetch(
	sid: string,
	cursor: string,
	baseUrl: string,
	authHeaders: Record<string, string>,
	signal: AbortSignal,
): Promise<Response> {
	const base = baseUrl.replace(/\/+$/, "");
	const url = `${base}/v1/messages/${encodeURIComponent(sid)}/events`;
	const headers: Record<string, string> = {
		Accept: "text/event-stream",
		...authHeaders,
	};
	if (cursor) {
		headers["Last-Event-ID"] = cursor;
	}
	logForDebugging(`[Stream-Resume] Resume GET ${url} cursor=${cursor}`);
	// P1-23: the resume GET had only the turn AbortSignal. A slow/malicious
	// gateway that accepts the connection but never sends a byte hangs the
	// turn until the user ESCs. Add a hard fetch timeout so a stuck resume
	// endpoint cannot pin the turn; the caller falls through to the
	// existing non-streaming fallback on timeout.
	const RESUME_FETCH_TIMEOUT_MS = Number.isFinite(
		parseInt(process.env.FUSION_CODE_STREAM_RESUME_FETCH_TIMEOUT_MS ?? "", 10),
	)
		? parseInt(process.env.FUSION_CODE_STREAM_RESUME_FETCH_TIMEOUT_MS ?? "", 10)
		: 30_000;
	const timeoutSignal = AbortSignal.timeout(RESUME_FETCH_TIMEOUT_MS);
	const combinedSignal = signal
		? AbortSignal.any([signal, timeoutSignal])
		: timeoutSignal;
	let resp: Response;
	try {
		resp = await fetch(url, {
			method: "GET",
			headers,
			signal: combinedSignal,
		});
	} catch (fetchErr) {
		// audit-0902 P0-3: a pure resume-fetch timeout (timeoutSignal fired,
		// NOT the user turn-abort signal) must NOT escape as a generic
		// timeout. classifyError would map it to TIMEOUT → isRetryable true →
		// withRetry retries the FULL turn from zero, duplicating all
		// generated tokens and defeating resume entirely. The user-abort path
		// (signal.aborted) stays ABORTED (also non-retryable). Mark the
		// pure-timeout case with .name "AbortError" so classifyError (line 90)
		// classifies it ABORTED = non-retryable → falls through to fallback,
		// not a full-turn retry.
		if (
			!signal?.aborted &&
			(fetchErr instanceof DOMException
				? fetchErr.name === "TimeoutError"
				: /timed?\s*out|timeout/i.test((fetchErr as Error)?.message ?? ""))
		) {
			const err = new Error(
				`[Stream-Resume] Resume fetch timed out after ${RESUME_FETCH_TIMEOUT_MS}ms`,
			);
			err.name = "AbortError";
			throw err;
		}
		throw fetchErr;
	}
	if (!resp.ok) {
		// 404 = server-side disabled/unknown/evicted → not resumable; throw and fall to the fallback.
		const bodyText = await resp.text().catch(() => "");
		throw new Error(
			`[Stream-Resume] Resume endpoint ${resp.status}: ${bodyText.slice(0, 200)}`,
		);
	}
	if (!resp.body) {
		throw new Error("[Stream-Resume] Resume response has no body");
	}
	return resp;
}

// ─── Merge (STATE-CONTINUATION) ───────────────────────────────
// Seed-continue via transformMLXStreamToAnthropic(resumed, model, seedState), dropping the first
// message_start (claude.ts already holds this turn's message_start); the seed continues contentIndex/
// textBuffer/emittedTextLen/textBlockOpen/thinkingBlockOpen/currentToolCall →
// correct indices / only new text emitted / mid-tool args continued / spurious content_block_start suppressed.

// Merge: seed-continue the transform of the resumed OpenAI-SSE, dropping the first message_start.
// Seed = deep clone of the pre-drop StreamState (claude.ts clones at the drop point, isolating the two streams from corruption).
// Continuation: contentIndex continues at N (the resumed content_block_start lands at the index claude.ts expects, no RangeError);
//   textBuffer/emittedTextLen continue → slice emits only new text (no duplicates); textBlockOpen true →
//   suppresses spurious content_block_start; currentToolCall continues mid-tool → args append under the same id/name.
// Sole filter: drop the message_start the resumed transform emits on startup (it carries a new message_id + zero usage
//   that would overwrite claude.ts's partialMessage for this turn). The trailing message_delta+message_stop are only sent on real completion → keep them.
export async function* mergeResumedStream(
	resumedResponse: Response,
	model: string,
	seedState?: StreamState,
	inputTokens?: number,
	stateRef?: { current: StreamState | undefined },
): AsyncGenerator<AnthropicStreamEvent> {
	let droppedMessageStart = false;
	// P1-25: thread stateRef through to the resumed transform. Without it the
	// resumed stream's evolving state is invisible to claude.ts, so a SECOND
	// drop during resume would clone the STALE pre-drop state again → re-emit
	// already-received resumed bytes (duplicate text) or RangeError on index
	// mismatch. The ref gives claude.ts the live resumed state to clone next.
	const resumed = transformMLXStreamToAnthropic(
		resumedResponse,
		model,
		inputTokens,
		seedState,
		stateRef,
	);
	for await (const part of resumed) {
		// Drop the first message_start (the resumed transform emits it unconditionally on startup, regardless of the seed).
		if (!droppedMessageStart && part.type === "message_start") {
			droppedMessageStart = true;
			continue;
		}
		yield part;
	}
}

// ─── Drop classification (resume-eligible) ─────────────────────────────
// Only timeout-class errors are accepted (pipe drained, lag=0, cursor+state consistent and safe). Excludes hard
// transport resets (in-flight lag → cursor over-consumes → replay loses frames → corruption) + APIError 4xx + user aborts.

// Drop classification: only timeout-class (pipe drained — transform/encode/seam all drained, lag=0
// → cursor+state consistent, replay safe). Excludes hard transport resets (in-flight lag → cursor
// over-consumes → replay loses frames → corruption/RangeError) + APIError 4xx (server-side rejection; resume
// cannot fix auth) + user aborts.
// streamIdleAborted = claude.ts's 300s watchdog already fired (no new chunks = drained, safe).
export function isResumeEligibleError(
	error: unknown,
	streamIdleAborted: boolean,
	producedContent = false,
): boolean {
	if (!(error instanceof Error)) return false;
	// idle-watchdog abort = claude.ts saw no new chunks for 300s = pipe drained (lag=0).
	// Even if content was already produced, the cursor records the last delivered event → replay starts from the cursor, no duplicates.
	// So an idle-abort is always safe (independent of producedContent).
	if (streamIdleAborted) return true;
	// Timeout-class: MLX idle (msg "Idle timeout" / "timeout") / seam StallTimeoutError
	// (name contains Timeout) / claude.ts watchdog idle. isTimeoutErrorLike already covers messages containing
	// "timeout" (case-insensitive, incl. "Idle timeout") + names containing "Timeout".
	// P1-4 (audit 0901): a generic timeout does not guarantee the pipe is drained — a request-level hard timeout
	// can fire mid-stream, where the cursor may lag behind events the server already persisted → replay would
	// duplicate content. Only when no content has been produced yet (first-token stage = definitely drained)
	// is a generic timeout considered resumable. Generic timeouts after content was produced take the original
	// fallback (byte-identical).
	if (isTimeoutErrorLike(error)) return !producedContent;
	return false;
}

// ─── Response side-channel attachment (WeakMap) ───────────────────────────
// The adapter attaches {cursorRef, stateRef} to the mlxResponse; claude.ts retrieves them on drop.

// Response side-channel attachment: the adapter attaches {cursorRef, stateRef} to mlxResponse;
// claude.ts retrieves them on drop. WeakMap key = the Response object (a Symbol prop would also work; WeakMap is more robust).
export interface ResumeRefs {
	cursorRef: CursorRef;
	stateRef: StateRef;
	sid: string;
	// The resume GET needs baseUrl + authHeaders: the adapter already built them; attach to avoid
	// claude.ts depending on adapter-private helpers (getMlxBaseUrl/getMlxAuthHeaders). Pure function values, a snapshot suffices.
	baseUrl: string;
	authHeaders: Record<string, string>;
}

const resumeRefsByResponse = new WeakMap<Response, ResumeRefs>();

export function attachResumeRefs(response: Response, refs: ResumeRefs): void {
	resumeRefsByResponse.set(response, refs);
}

export function getResumeRefs(response: Response): ResumeRefs | undefined {
	return resumeRefsByResponse.get(response);
}

// ─── audit 2.2.2: idle-watchdog abort gate + refs survivor ────────────
// Two claude.ts pure decisions extracted into tested contracts (the original bug = this logic was inlined with no test coverage).

// audit 2.2.2: should an abort-shaped error (no user signal) skip the synthetic-timeout throw
// and fall to the resume check? Only when the idle-watchdog fired AND resume is on — otherwise
// byte-identical to the old throw path. The idle body.cancel() is not signal.abort() → signal.aborted=false →
// the old else threw unconditionally, short-circuiting resume (:2532). This gate lets idle fall to the resume check.
export function shouldDeferIdleAbortToResume(
	streamIdleAborted: boolean,
	resumeEnabled: boolean,
): boolean {
	return streamIdleAborted && resumeEnabled;
}

// audit 2.2.2: resolve refs from the live Response, falling back to the survivor. The watchdog's
// releaseStreamResources() nulls streamResponse before the catch; the WeakMap entry keyed by the Response
// is GC'd as soon as its sole strong reference breaks → getResumeRefs returns undefined → refs?.sid=false →
// the resume try-block is skipped (bug unfixed). The survivor = the refs object captured before release
// when the watchdog fired (a small independent allocation; resume needs its stateRef as seedState anyway).
// When the live Response is present, prefer it (race-safe: on the second drop, streamResponse has been
// reassigned to the resumed Response).
// P1-2 (audit v2-0912): "live preferred" must not become "live exclusive" — if the live Response is present
// but the WeakMap has no refs (not attached / already GC'd), fall back to the survivor, otherwise resume
// silently fails → full-turn replay, exactly the failure mode the P0-3/P1-23 fixes were meant to eliminate.
export function resolveResumeRefs(
	response: Response | undefined,
	survivor: ResumeRefs | undefined,
): ResumeRefs | undefined {
	if (response) return getResumeRefs(response) ?? survivor;
	return survivor;
}

export type { StreamState };
