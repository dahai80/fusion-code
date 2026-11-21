// Generic SSE parsing (text/event-stream -> event stream)
//
// Replacement for the Anthropic SDK's Stream: reads the fetch Response.body as a byte stream and splits it into
// structured events at SSE frame boundaries (events separated by blank lines, data:/event:/: comment lines).
//
// Spec reference: MDN Server-sent events
// - Multi-line data: joined with "\n" into a single data field
// - event: line specifies the event type (defaults to "message")
// - Lines starting with ":" are comments/heartbeats, ignored
// - One blank line triggers one event dispatch
//
// Fault tolerance: when a partial block straddles a chunk boundary, the incomplete line stays in the buffer until the next read (mirrors the existing implementation in fusion-mlx-stream.ts).

export interface SseEvent {
	event: string;
	data: string;
	id?: string;
}

// Idle/stall watchdog options for parseSseStream. A stalled upstream (hung
// inference, dropped connection without RST, gateway stall) otherwise keeps
// reader.read() pending forever with no recovery. Default budgets are env
// driven; pass stallMs: 0 to disable entirely.
export interface ParseSseOptions {
	// Max ms between received chunks once first byte arrived. 0 = disable.
	stallMs?: number;
	// Max ms to first byte (prefill can be slow). 0 = same as stallMs.
	firstTokenMs?: number;
}

// StallTimeoutError: name contains "Timeout" so classifyByMessage -> TIMEOUT
// (retryable via withRetry), and isTimeoutErrorLike duck-types true.
export class StallTimeoutError extends Error {
	// P1-26: phase extended with "hard-timeout" — hard safety-net timeouts use this phase when the watchdog is disabled.
	public readonly phase: "first-token" | "idle" | "hard-timeout";
	constructor(
		phase: "first-token" | "idle" | "hard-timeout",
		elapsedMs: number,
		budgetMs: number,
	) {
		super(
			`SSE stream ${phase} timeout: ${elapsedMs}ms > ${budgetMs}ms budget (stalled upstream)`,
		);
		this.name = "StallTimeoutError";
		this.phase = phase;
	}
}

// Env-driven default budgets. 0 disables the watchdog (byte-identical to
// pre-fix behavior). FUSION_CODE_SSE_STALL_MS=0 / FUSION_CODE_SSE_FIRST_TOKEN_MS=0.
const DEFAULT_STALL_MS = parseInt(
	process.env.FUSION_CODE_SSE_STALL_MS ?? "60000",
	10,
);
const DEFAULT_FIRST_TOKEN_MS = parseInt(
	process.env.FUSION_CODE_SSE_FIRST_TOKEN_MS ?? "180000",
	10,
);

// P1-26: hard safety net for when both budgets are 0 (watchdog disabled). A bare reader.read() hanging on the upstream = hang
// forever until ESC. Even when the user explicitly disables stall detection, a 10min hard timeout is still forced as a backstop —
// a genuinely hung upstream throws StallTimeoutError instead of hanging silently. 10min far exceeds the chunk interval of normal
// long generations (10× the 60s default stall), so normal streams never trip it; it only catches dead connections with "zero bytes".
const HARD_READ_TIMEOUT_MS = 10 * 60 * 1000;

function resolveBudgets(options?: ParseSseOptions): {
	stallMs: number;
	firstTokenMs: number;
} {
	const stallMs =
		options?.stallMs ??
		(Number.isNaN(DEFAULT_STALL_MS) ? 60000 : DEFAULT_STALL_MS);
	const firstTokenMs =
		options?.firstTokenMs ??
		(Number.isNaN(DEFAULT_FIRST_TOKEN_MS) ? 180000 : DEFAULT_FIRST_TOKEN_MS);
	return { stallMs, firstTokenMs };
}

// Race reader.read() against a stall timer. On timeout, cancel the reader
// (releases the read) and throw StallTimeoutError. Timer resets after first
// byte to the inter-chunk idle budget. Rejects with AbortError if signal
// aborts mid-read (preserves existing abort semantics).
async function readWithStallGuard(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal: AbortSignal | undefined,
	budgets: { stallMs: number; firstTokenMs: number },
	sawFirstByte: { v: boolean },
): Promise<Awaited<ReturnType<typeof reader.read>>> {
	const disabled = budgets.stallMs <= 0 && budgets.firstTokenMs <= 0;
	if (disabled) {
		if (signal?.aborted)
			throw new DOMException("SSE stream aborted", "AbortError");
		// P1-26: forced hard-timeout safety net when the watchdog is disabled — prevents a bare reader.read() from hanging forever.
		// Race the read against a HARD_READ_TIMEOUT_MS timer; on timeout cancel the reader + throw StallTimeoutError.
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const err = new StallTimeoutError(
					"hard-timeout",
					HARD_READ_TIMEOUT_MS,
					HARD_READ_TIMEOUT_MS,
				);
				void reader.cancel().catch(() => {});
				reject(err);
			}, HARD_READ_TIMEOUT_MS);
			reader
				.read()
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((err) => {
					clearTimeout(timer);
					reject(err);
				});
		});
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	// P1-5 (audit 0901): holder captures onAbort outside the executor so the
	// settle handler below can removeEventListener on every terminal path.
	const abortHolder: { onAbort?: () => void } = {};

	type ReadResult = Awaited<ReturnType<typeof reader.read>>;
	const armed = new Promise<ReadResult>((resolve, reject) => {
		const armTimer = () => {
			if (timer) clearTimeout(timer);
			const budget = sawFirstByte.v ? budgets.stallMs : budgets.firstTokenMs;
			if (budget <= 0) return;
			const startedAt = Date.now();
			timer = setTimeout(() => {
				const phase = sawFirstByte.v ? "idle" : "first-token";
				const err = new StallTimeoutError(
					phase,
					Date.now() - startedAt,
					budget,
				);
				// Cancel releases the pending reader.read(); its promise then
				// rejects with a TypeError — but we reject first via our own.
				void reader.cancel().catch(() => {});
				reject(err);
			}, budget);
		};
		armTimer();

		reader
			.read()
			.then((result) => {
				if (timer) clearTimeout(timer);
				if (!sawFirstByte.v && !result.done) sawFirstByte.v = true;
				resolve(result);
			})
			.catch((err: unknown) => {
				if (timer) clearTimeout(timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			});

		if (signal) {
			const onAbort = () => {
				if (timer) clearTimeout(timer);
				void reader.cancel().catch(() => {});
				reject(new DOMException("SSE stream aborted", "AbortError"));
			};
			if (signal.aborted) onAbort();
			else {
				signal.addEventListener("abort", onAbort, { once: true });
				abortHolder.onAbort = onAbort;
			}
		}
	});

	// P1-5 (audit 0901): remove the abort listener on every terminal path
	// EXCEPT abort itself ({ once: true } already removed it there). Without
	// this, every successful read (done or data chunk) leaves a dangling
	// listener on the AbortSignal — a reused/long-lived signal accumulates
	// one listener per read() call = O(n) leak across a stream, retained
	// until the signal itself is GC'd. removeEventListener is a safe no-op
	// on an already-removed listener (the abort-fired path).
	const cleanup = () => {
		if (abortHolder.onAbort && signal) {
			signal.removeEventListener("abort", abortHolder.onAbort);
			abortHolder.onAbort = undefined;
		}
	};
	return armed.then(
		(r) => {
			cleanup();
			return r;
		},
		(err: Error) => {
			cleanup();
			// Ensure any in-flight timer is cleared on rejection path.
			if (timer) clearTimeout(timer);
			throw err;
		},
	);
}

// Parses a ReadableStream<Uint8Array> (fetch Response.body) into an async iterator of SseEvent.
export async function* parseSseStream(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
	options?: ParseSseOptions,
): AsyncIterable<SseEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let event = "message";
	let dataLines: string[] = [];
	let lastId: string | undefined;
	const budgets = resolveBudgets(options);
	const sawFirstByte = { v: false };

	try {
		while (true) {
			if (signal?.aborted) {
				throw new DOMException("SSE stream aborted", "AbortError");
			}
			const { done, value } = await readWithStallGuard(
				reader,
				signal,
				budgets,
				sawFirstByte,
			);
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// Split into lines on newlines; an unfinished trailing line stays in the buffer
			const lines = buffer.split(/\r\n|\r|\n/);
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				// Blank line: dispatch the current event and reset
				if (line === "") {
					if (dataLines.length > 0) {
						yield {
							event,
							data: dataLines.join("\n"),
							id: lastId,
						};
					}
					event = "message";
					dataLines = [];
					continue;
				}
				// Comment/heartbeat
				if (line.startsWith(":")) continue;
				const colonIdx = line.indexOf(":");
				if (colonIdx === -1) {
					continue;
				}
				const field = line.slice(0, colonIdx);
				let val = line.slice(colonIdx + 1);
				if (val.startsWith(" ")) val = val.slice(1);
				switch (field) {
					case "event":
						event = val;
						break;
					case "data":
						dataLines.push(val);
						break;
					case "id":
						lastId = val;
						break;
					case "retry":
						break;
					default:
						break;
				}
			}
		}

		// Handle the trailing leftover buffer (edge case where the stream does not end with a blank line)
		buffer += decoder.decode();
		if (buffer !== "") {
			const trailing = buffer.split(/\r\n|\r|\n/);
			for (const line of trailing) {
				if (line === "") continue;
				if (line.startsWith(":")) continue;
				const colonIdx = line.indexOf(":");
				if (colonIdx === -1) continue;
				const field = line.slice(0, colonIdx);
				let val = line.slice(colonIdx + 1);
				if (val.startsWith(" ")) val = val.slice(1);
				if (field === "data") dataLines.push(val);
				else if (field === "event") event = val;
			}
		}
		if (dataLines.length > 0) {
			yield { event, data: dataLines.join("\n"), id: lastId };
		}
	} finally {
		reader.releaseLock();
	}
}
