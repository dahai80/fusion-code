// 通用 SSE 解析 (text/event-stream -> 事件流)
//
// 替代 Anthropic SDK 的 Stream: 把 fetch Response.body 按字节流读入, 按 SSE 帧边界
// (空行分隔事件, data:/event:/: 注释行) 切成结构化事件。
//
// 规范依据: MDN Server-sent events
// - 多行 data: 用 "\n" 连接为单个 data 字段
// - event: 行指定事件类型 (缺省 "message")
// - 以 ":" 开头为注释/心跳, 忽略
// - 一个空行触发一个事件派发
//
// 容错: 部分块跨 chunk 边界时, 未完成的行留在 buffer 直到下次读取 (参考 fusion-mlx-stream.ts 现有实现)。

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
    // P1-26: phase 扩 "hard-timeout" — watchdog 禁用时硬安全网超时用此 phase。
    public readonly phase: "first-token" | "idle" | "hard-timeout";
    constructor(
        phase: "first-token" | "idle" | "hard-timeout",
        elapsedMs: number,
        budgetMs: number,
    ) {
        super(`SSE stream ${phase} timeout: ${elapsedMs}ms > ${budgetMs}ms budget (stalled upstream)`);
        this.name = "StallTimeoutError";
        this.phase = phase;
    }
}

// Env-driven default budgets. 0 disables the watchdog (byte-identical to
// pre-fix behavior). FUSION_CODE_SSE_STALL_MS=0 / FUSION_CODE_SSE_FIRST_TOKEN_MS=0.
const DEFAULT_STALL_MS = parseInt(process.env.FUSION_CODE_SSE_STALL_MS ?? "60000", 10);
const DEFAULT_FIRST_TOKEN_MS = parseInt(process.env.FUSION_CODE_SSE_FIRST_TOKEN_MS ?? "180000", 10);

// P1-26: 双预算 0 (watchdog 禁用) 时的硬安全网。裸 reader.read() 挂死上游 = 永挂
// 直到 ESC。即便用户显式禁用 stall 检测, 仍强制 10min 硬超时兜底 — 上游真挂会
// 抛 StallTimeoutError 而非静默永挂。10min 远超正常长生成的 chunk 间隔 (60s 默认 stall
// 的 10×), 正常流不会误触; 仅兜底"无任何字节"的死连接。
const HARD_READ_TIMEOUT_MS = 10 * 60 * 1000;

function resolveBudgets(options?: ParseSseOptions): {
    stallMs: number;
    firstTokenMs: number;
} {
    const stallMs = options?.stallMs ?? (Number.isNaN(DEFAULT_STALL_MS) ? 60000 : DEFAULT_STALL_MS);
    const firstTokenMs =
        options?.firstTokenMs ?? (Number.isNaN(DEFAULT_FIRST_TOKEN_MS) ? 180000 : DEFAULT_FIRST_TOKEN_MS);
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
        if (signal?.aborted) throw new DOMException("SSE stream aborted", "AbortError");
        // P1-26: watchdog 禁用时强制硬超时安全网 — 防裸 reader.read() 永挂。
        // Race read 对 HARD_READ_TIMEOUT_MS timer, 超时 cancel reader + 抛 StallTimeoutError。
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const err = new StallTimeoutError("hard-timeout", HARD_READ_TIMEOUT_MS, HARD_READ_TIMEOUT_MS);
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
                const err = new StallTimeoutError(phase, Date.now() - startedAt, budget);
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

// 把一个 ReadableStream<Uint8Array> (fetch Response.body) 解析成 SseEvent 异步迭代器。
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
            const { done, value } = await readWithStallGuard(reader, signal, budgets, sawFirstByte);
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // 按换行切行; 末尾未完成行留在 buffer
            const lines = buffer.split(/\r\n|\r|\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                // 空行: 派发当前事件并重置
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
                // 注释/心跳
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

        // 处理尾部残留 buffer (流未以空行结尾的边界)
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
