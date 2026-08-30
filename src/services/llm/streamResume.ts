// Stream-resume client slice (gw#123 server half; fusion-code client half).
//
// 当本地 MLX 流式生成中途因传输/超时类错误掉线 (非用户中断), 客户端携带
// Last-Event-ID 重连 gateway 的 resume 端点 (GET /v1/messages/{sid}/events),
// 合并 replay 帧 + live tail 续上 claude.ts 的 for-await, 而非整轮重发。
//
// 服务端契约 (gw#123, 只读): config routing.stream.resume_enabled (默认 false)
// AND route == LocalBackend; sid = 请求 X-Request-ID; 响应头 X-Fusion-Stream-ID;
// 每 SSE 帧 id: <sid>:<seq> (单调); 有界 buffer (256 events / 1MiB / 10m TTL);
// resume 端点 GET /v1/messages/{sid}/events, 游标 Last-Event-ID 头 (优先) 或
// ?last_event_id=; 解析 strings.LastIndex(cursor,":")+Atoi; 两阶段 replay-after-cursor
// + live drain; 404 = disabled/unknown/evicted。
//
// 关键: cursor 在 fusion-code MLX 翻译层丢失 3 处 —
//   B1 transformMLXStreamToAnthropic 只解析 data: 行 → id: 被剥离
//   B2 encodeStreamToAnthropicSSE:1284 spread 原响应头 → X-Fusion-Stream-ID 透传 (无需改)
//   B3 streamViaSeam sseToChunk 丢弃 evt.id
// 方案: teeCursor 在 transform 前侧信道提取 id: → mutable ref; sid 从 streamResponse
// 头读取 (B2 透传); resume-eligible 错误 (timeout 类 = 管道已排空, lag=0) 在 claude.ts
// catch 重连, STATE-CONTINUATION (深克隆 pre-drop StreamState 续种子) 合并无重放乱序。
//
// default-off (FUSION_CODE_STREAM_RESUME_ENABLED), off = byte-identical。env-gate 非
// feature() 运行期 cast (PR#9 build bug: feature() 要字符串字面量做 DCE)。

import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import {
	type AnthropicStreamEvent,
	type StreamState,
	transformMLXStreamToAnthropic,
} from "../api/fusion-mlx-stream.js";
import { isTimeoutErrorLike } from "./errors.js";

// ─── 门控 ─────────────────────────────────────────────────────

// resume 是否启用 (env 门控, default-off byte-identical)。
export function isStreamResumeEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_STREAM_RESUME_ENABLED);
}

// 每轮 resume 重连上限 (默认 3)。
export function maxAttempts(): number {
	const raw = parseInt(
		process.env.FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS ?? "",
		10,
	);
	return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

// ─── 游标侧信道 (teeCursor) ──────────────────────────────────
// B1 修复: transform 前拆 SSE 帧, 提取 id: <sid>:<seq> 到 mutable ref,
// 帧原样透传 transform 不变。claude.ts 掉线时读 ref.current 拿游标。

// 游标 ref: mutable, transform/adapter 不写; claude.ts 掉线时读 last seen id。
export type CursorRef = { current: string };
// 状态 ref: transform 每 processChunk 写 live state; claude.ts 掉线时深克隆。
export type StateRef = { current: StreamState | undefined };

// 拆 SSE 帧 (按 \n\n 分隔), 提取每帧 id: 行到 ref, 帧原样透传。
// 透传 = 字节不变: transform 照旧只解析 data:, 行为 byte-identical。
// ref.current 始终是最近见到的 id (gateway 每帧都带 id; 无 id 帧 → ref 不更新)。
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
					// 先透传原字节 (transform 消费不变), 再旁路提 id。
					controller.enqueue(value);
					buffer += decoder.decode(value, { stream: true });

					// 按行扫 id: (不依赖帧边界 — id: 行格式 gateway 固定 "<sid>:<seq>")。
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (line.startsWith("id:")) {
							ref.current = line.slice(3).trim();
						}
					}
				}
				// 处理尾部残余行
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
			// 上游 (transform) 取消时, 透传到原始 body 释放资源。
			rawResponseBody.cancel(reason).catch(() => {});
		},
	});

	return { ref, stream };
}

// ─── resume GET (绕过 createFusionMlxFetch) ──────────────────
// resume GET URL 含 /v1/messages/{sid}/events, 匹配 adapter url.includes
// ("/v1/messages") 拦截器 → 会错误改写。故用真实 global fetch 直连 baseUrl。

// resume GET: 真实 global fetch 直连 baseUrl (绕过 createFusionMlxFetch 拦截器)。
// 游标 Last-Event-ID 头 = "<sid>:<seq>" (gateway 按 LastIndex(":")+Atoi 解析)。
// 返回 resumed OpenAI-SSE Response (含 id: 行, 同原始流形状)。
// 404 (disabled/evicted/TTL) / 非 2xx → 抛错 (claude.ts 落到既有 fallback)。
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
	const resp = await fetch(url, {
		method: "GET",
		headers,
		signal: combinedSignal,
	});
	if (!resp.ok) {
		// 404 = 服务端 disabled/unknown/evicted → 不可 resume, 抛错落到 fallback。
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

// ─── 合并 (STATE-CONTINUATION) ───────────────────────────────
// 种子续传 transformMLXStreamToAnthropic(resumed, model, seedState), 丢弃首
// message_start (claude.ts 已持有本轮 message_start); 种子续 contentIndex/
// textBuffer/emittedTextLen/textBlockOpen/thinkingBlockOpen/currentToolCall →
// 正确索引/只发新文本/续 mid-tool args/抑制 spurious content_block_start。

// 合并: 种子续传 transform resumed OpenAI-SSE, 丢弃首 message_start。
// 种子 = 深克隆 pre-drop StreamState (claude.ts 在掉线点克隆, 隔离双流腐败)。
// 续传: contentIndex 续 N (resumed content_block_start 在 claude.ts 期望索引, 无 RangeError);
//   textBuffer/emittedTextLen 续 → slice 只发新文本 (无重复); textBlockOpen true →
//   抑制 spurious content_block_start; currentToolCall 续 mid-tool → args 追加同 id/name。
// 唯一过滤: 丢弃 resumed transform 启动 message_start (它带新 message_id+零 usage 会覆盖
//   claude.ts 本轮 partialMessage)。尾部 message_delta+message_stop 真完成才发 → 保留。
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
		// 丢弃首 message_start (resumed transform 启动无条件发, 与种子无关)。
		if (!droppedMessageStart && part.type === "message_start") {
			droppedMessageStart = true;
			continue;
		}
		yield part;
	}
}

// ─── drop 判定 (resume-eligible) ─────────────────────────────
// 只接 timeout 类 (管道已排空 lag=0, cursor+state 一致安全)。排除硬传输 reset
// (管 lag → cursor 超前消费 → 重放丢帧 → 腐败) + APIError 4xx + 用户中断。

// drop 判定: 只接 timeout 类 (管道已排空, transform/encode/seam 都 drained, lag=0
// → cursor+state 一致, 重放安全)。排除硬传输 reset (管 lag → cursor 超前消费 → 重放
// 丢帧 → 腐败/RangeError) + APIError 4xx (服务端拒绝, resume 修不了 auth) + 用户中断。
// streamIdleAborted = claude.ts 300s watchdog 已触发 (无新块 = drained, 安全)。
export function isResumeEligibleError(
	error: unknown,
	streamIdleAborted: boolean,
): boolean {
	if (!(error instanceof Error)) return false;
	// timeout 类: MLX idle (msg "Idle timeout" / "timeout") / seam StallTimeoutError
	// (name 含 Timeout) / claude.ts watchdog idle。isTimeoutErrorLike 已覆盖 message 含
	// "timeout" (大小写不敏感, 含 "Idle timeout") + name 含 "Timeout"。
	if (isTimeoutErrorLike(error)) return true;
	if (streamIdleAborted) return true;
	return false;
}

// ─── Response 侧信道挂载 (WeakMap) ───────────────────────────
// adapter 把 {cursorRef, stateRef} 挂到 mlxResponse; claude.ts 掉线时取回。

// Response 侧信道挂载: adapter 把 {cursorRef, stateRef} 挂 mlxResponse;
// claude.ts 掉线时取回。WeakMap 键 = Response 对象 (Symbol prop 也可, WeakMap 更稳)。
export interface ResumeRefs {
	cursorRef: CursorRef;
	stateRef: StateRef;
	sid: string;
	// resume GET 需 baseUrl + authHeaders: adapter 已构建, 附上避免 claude.ts
	// 依赖 adapter 私有 helper (getMlxBaseUrl/getMlxAuthHeaders)。纯函数值, 快照即可。
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
// 两处 claude.ts 纯判定外移成 tested contract (原 bug = 这段逻辑内联且无测覆盖)。

// audit 2.2.2: abort 形错误 (无 user signal) 应否跳过 synthetic-timeout throw,
// 落到 resume 检查? 仅当 idle-watchdog 触发 AND resume 开启 — 否则 byte-identical
// 旧 throw 路径。idle body.cancel() 非 signal.abort() → signal.aborted=false →
// 旧 else 无条件 throw, 短路 resume (:2532)。此处门控让 idle 落到 resume 检查。
export function shouldDeferIdleAbortToResume(
	streamIdleAborted: boolean,
	resumeEnabled: boolean,
): boolean {
	return streamIdleAborted && resumeEnabled;
}

// audit 2.2.2: 从 live Response 解析 refs, fallback 到 survivor。watchdog 的
// releaseStreamResources() 先于 catch 把 streamResponse=null, WeakMap 项键 Response
// 一旦唯一强引用断即 GC → getResumeRefs 返回 undefined → refs?.sid=false →
// resume try-block 跳过 (bug 未修)。survivor = watchdog 触发时在 release 前捕获的
// refs 对象本身 (小独立分配, resume 本就需其 stateRef 做 seedState)。live Response
// 在场时优先 (race 安全: 第二次 drop 时 streamResponse 已重赋 resumed Response)。
export function resolveResumeRefs(
	response: Response | undefined,
	survivor: ResumeRefs | undefined,
): ResumeRefs | undefined {
	if (response) return getResumeRefs(response);
	return survivor;
}

export type { StreamState };
