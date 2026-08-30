// Stream-resume client slice 单测 (gw#123 客户端半)。
//
// 覆盖: teeCursor 游标侧信道 / transform seedState 续传 / mergeResumedStream 合并 /
// resumeStreamFetch GET 续连 / isResumeEligibleError drop 判定 / 门控 byte-identical。

import { afterEach, describe, expect, test } from "bun:test";
import { transformMLXStreamToAnthropic } from "../../services/api/index.js";
import {
	attachResumeRefs,
	getResumeRefs,
	isResumeEligibleError,
	isStreamResumeEnabled,
	maxAttempts,
	mergeResumedStream,
	resumeStreamFetch,
	teeCursor,
} from "../../services/llm/streamResume.js";

// ─── helpers ─────────────────────────────────────────────────

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(encoder.encode(c));
			controller.close();
		},
	});
}

// 读 teeCursor 透传流, 收集字节验证不变。
async function drainBytes(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let out = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	return out;
}

async function collectParts(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
	const out: unknown[] = [];
	for await (const p of gen) out.push(p);
	return out;
}

// 构造 OpenAI-SSE chunk (gateway 形状: data: {...} + id: <sid>:<seq>)。
function openaiSseChunk(
	sid: string,
	seq: number,
	payload: object,
	withId = true,
): string {
	const lines: string[] = [];
	if (withId) lines.push(`id: ${sid}:${seq}`);
	lines.push(`data: ${JSON.stringify(payload)}`);
	return `${lines.join("\n")}\n\n`;
}

// 构造带 body 的 Response (transform 消费 response.body)。
function sseResponse(chunks: string[]): Response {
	return new Response(makeStream(chunks), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

// ─── env 还原 ────────────────────────────────────────────────

const ENV_KEYS = [
	"FUSION_CODE_STREAM_RESUME_ENABLED",
	"FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS",
];
const saved: Record<string, string | undefined> = {};

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
		delete saved[k];
	}
});

function setEnv(key: string, val: string): void {
	if (!(key in saved)) saved[key] = process.env[key];
	process.env[key] = val;
}

// ─── teeCursor ───────────────────────────────────────────────

describe("teeCursor", () => {
	test("extracts id: seq into ref, passes frames through unchanged", async () => {
		const raw = makeStream([
			'id: sid-1:3\ndata: {"a":1}\n\n',
			'id: sid-1:7\ndata: {"b":2}\n\n',
		]);
		const { ref, stream } = teeCursor(raw);
		const out = await drainBytes(stream);
		// 透传字节不变
		expect(out).toBe(
			'id: sid-1:3\ndata: {"a":1}\n\nid: sid-1:7\ndata: {"b":2}\n\n',
		);
		// ref 持最近见到的 id (drain 完成后)
		expect(ref.current).toBe("sid-1:7");
	});

	test("no id: lines -> ref stays empty string", async () => {
		const raw = makeStream(['data: {"x":1}\n\nevent: ping\n\n']);
		const { ref, stream } = teeCursor(raw);
		await drainBytes(stream);
		expect(ref.current).toBe("");
	});

	test("multi-frame ordering: ref tracks last id across split chunks", async () => {
		const raw = makeStream([
			'id: s:1\ndata: {"a":1}\n\nid: s:2',
			'\ndata: {"a":2}\n\nid: s:5\ndata: {"a":3}\n\n',
		]);
		const { ref, stream } = teeCursor(raw);
		await drainBytes(stream);
		expect(ref.current).toBe("s:5");
	});

	test("event: + data: frames pass through (id: optional)", async () => {
		const raw = makeStream([
			'event: ping\ndata: {}\n\nid: s:9\ndata: {"k":true}\n\n',
		]);
		const { ref, stream } = teeCursor(raw);
		const out = await drainBytes(stream);
		expect(out).toBe('event: ping\ndata: {}\n\nid: s:9\ndata: {"k":true}\n\n');
		expect(ref.current).toBe("s:9");
	});
});

// ─── transformMLXStreamToAnthropic seedState ─────────────────

describe("transformMLXStreamToAnthropic seedState", () => {
	test("undefined seed -> fresh start yields message_start at index 0", async () => {
		const resp = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: "hi" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(
			transformMLXStreamToAnthropic(resp, "test-model"),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		expect(types[0]).toBe("message_start");
		// 文本块 content_block_start 在 index 0
		const start = parts.find(
			(p) => (p as { type: string }).type === "content_block_start",
		) as { index: number };
		expect(start.index).toBe(0);
	});

	test("seed with textBlockOpen=true -> resumed delta continues, no spurious content_block_start", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: null,
			textBlockOpen: true,
			thinkingBlockOpen: false,
			textBuffer: "Hello",
			emittedTextLen: 5,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resp = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: " world" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const stateRef = { current: undefined };
		const parts = await collectParts(
			transformMLXStreamToAnthropic(
				resp,
				"test-model",
				undefined,
				seed,
				stateRef,
			),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		// seed -> 无 message_start (续传)
		expect(types).not.toContain("message_start");
		// textBlockOpen=true -> 无新 content_block_start (续同块)
		const starts = parts.filter(
			(p) => (p as { type: string }).type === "content_block_start",
		);
		expect(starts.length).toBe(0);
		// 文本 delta 只发新文本 " world" (slice from emittedTextLen=5)
		const deltas = parts
			.filter((p) => (p as { type: string }).type === "content_block_delta")
			.map((p) => (p as { delta: { text?: string } }).delta.text)
			.filter(Boolean);
		expect(deltas.join("")).toBe(" world");
		// delta 索引续在 contentIndex-1 = 0 (预掉线块)
		const deltaEvents = parts.filter(
			(p) => (p as { type: string }).type === "content_block_delta",
		);
		expect((deltaEvents[0] as { index: number }).index).toBe(0);
		// stateRef 挂了 live state
		expect(stateRef.current).toBeDefined();
		expect(stateRef.current?.textBuffer).toBe("Hello world");
	});

	test("seed mid-tool -> resumed args append, no new content_block_start, id/name preserved", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: {
				index: 0,
				id: "tool_1",
				name: "Bash",
				arguments: '{"cmd":"ls',
			},
			textBlockOpen: false,
			thinkingBlockOpen: false,
			textBuffer: "",
			emittedTextLen: 0,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resp = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: { arguments: ' -l"}' },
								},
							],
						},
						index: 0,
					},
				],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
			}),
		]);
		const parts = await collectParts(
			transformMLXStreamToAnthropic(resp, "test-model", undefined, seed),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		// mid-tool 续传: 无新 content_block_start (块已开)
		expect(types).not.toContain("content_block_start");
		// args delta 追加
		const argDeltas = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { partial_json?: string } }).delta.partial_json !==
						undefined,
			)
			.map((p) => (p as { delta: { partial_json: string } }).delta.partial_json)
			.join("");
		expect(argDeltas).toBe(' -l"}');
	});

	test("seed preserves messageId on resumed message_start when not dropped", async () => {
		// mergeResumedStream 会丢首 message_start; 这里直接 transform 验种子保留 messageId。
		const seed = {
			messageId: "msg_keep_id",
			model: "test-model",
			contentIndex: 0,
			currentToolCall: null,
			textBlockOpen: false,
			thinkingBlockOpen: false,
			textBuffer: "",
			emittedTextLen: 0,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		// seed 存在 -> transform 跳过 message_start; 用空流验证不 yield message_start
		const resp = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(
			transformMLXStreamToAnthropic(resp, "test-model", undefined, seed),
		);
		expect(parts.map((p) => (p as { type: string }).type)).not.toContain(
			"message_start",
		);
	});
});

// ─── mergeResumedStream ──────────────────────────────────────

describe("mergeResumedStream", () => {
	test("drops first message_start, passes rest through", async () => {
		// resumed OpenAI 流 -> transform 会 yield message_start (因 seedState=undefined);
		// merge 丢首 message_start。
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: "tail" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(mergeResumedStream(resumed, "test-model"));
		const types = parts.map((p) => (p as { type: string }).type);
		expect(types).not.toContain("message_start");
		// 尾部 message_delta + message_stop 保留
		expect(types).toContain("message_delta");
		expect(types).toContain("message_stop");
	});

	test("no seedState (undefined) -> cold start text block at index 0", async () => {
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: "fresh" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(
			mergeResumedStream(resumed, "test-model", undefined),
		);
		const start = parts.find(
			(p) => (p as { type: string }).type === "content_block_start",
		) as { index: number };
		expect(start.index).toBe(0);
		const text = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { text?: string } }).delta.text,
			)
			.map((p) => (p as { delta: { text: string } }).delta.text)
			.join("");
		expect(text).toBe("fresh");
	});

	test("seedState textBlockOpen=true -> resumed delta continues pre-drop block (no dup)", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: null,
			textBlockOpen: true,
			thinkingBlockOpen: false,
			textBuffer: "Hello",
			emittedTextLen: 5,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: " world" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(
			mergeResumedStream(resumed, "test-model", seed),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		// 无 message_start (丢) + 无 content_block_start (textBlockOpen 续)
		expect(types).not.toContain("message_start");
		expect(types).not.toContain("content_block_start");
		const text = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { text?: string } }).delta.text,
			)
			.map((p) => (p as { delta: { text: string } }).delta.text)
			.join("");
		expect(text).toBe(" world");
	});

	test("seedState mid-tool -> resumed args append, id/name preserved", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: {
				index: 0,
				id: "tool_1",
				name: "Bash",
				arguments: '{"cmd":"ls',
			},
			textBlockOpen: false,
			thinkingBlockOpen: false,
			textBuffer: "",
			emittedTextLen: 0,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: ' -l"}' } }],
						},
						index: 0,
					},
				],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
			}),
		]);
		const parts = await collectParts(
			mergeResumedStream(resumed, "test-model", seed),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		// 无新 content_block_start (mid-tool 续)
		expect(types).not.toContain("content_block_start");
		const argDeltas = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { partial_json?: string } }).delta.partial_json !==
						undefined,
			)
			.map((p) => (p as { delta: { partial_json: string } }).delta.partial_json)
			.join("");
		expect(argDeltas).toBe(' -l"}');
	});

	test("terminal message_delta + message_stop passed through once", async () => {
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: "end" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
				usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
			}),
		]);
		const parts = await collectParts(mergeResumedStream(resumed, "test-model"));
		const deltas = parts.filter(
			(p) => (p as { type: string }).type === "message_delta",
		);
		const stops = parts.filter(
			(p) => (p as { type: string }).type === "message_stop",
		);
		expect(deltas.length).toBe(1);
		expect(stops.length).toBe(1);
	});
});

// ─── resumeStreamFetch ───────────────────────────────────────

describe("resumeStreamFetch", () => {
	test("GET method, URL {base}/v1/messages/{sid}/events, Last-Event-ID header, auth headers present", async () => {
		const calls: Array<{
			url: string;
			method: string;
			headers: Record<string, string>;
		}> = [];
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url = typeof input === "string" ? input : input.toString();
			const headers: Record<string, string> = {};
			if (init?.headers) {
				const h = new Headers(init.headers);
				h.forEach((v, k) => {
					headers[k] = v;
				});
			}
			calls.push({ url, method: init?.method ?? "GET", headers });
			return new Response(makeStream(["data: ok\n\n"]), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}) as typeof fetch;
		try {
			const resp = await resumeStreamFetch(
				"sid-abc",
				"sid-abc:7",
				"http://127.0.0.1:11432",
				{ Authorization: "Bearer tok", "X-Fusion-Route": "local" },
				new AbortController().signal,
			);
			expect(resp.ok).toBe(true);
			expect(calls.length).toBe(1);
			expect(calls[0].method).toBe("GET");
			expect(calls[0].url).toBe(
				"http://127.0.0.1:11432/v1/messages/sid-abc/events",
			);
			expect(calls[0].headers["last-event-id"]).toBe("sid-abc:7");
			expect(calls[0].headers.authorization).toBe("Bearer tok");
			expect(calls[0].headers["x-fusion-route"]).toBe("local");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	test("baseUrl trailing slashes stripped", async () => {
		const calls: string[] = [];
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			calls.push(typeof input === "string" ? input : input.toString());
			return new Response(makeStream(["data: ok\n\n"]), { status: 200 });
		}) as typeof fetch;
		try {
			await resumeStreamFetch(
				"sid",
				"sid:1",
				"http://127.0.0.1:11432///",
				{},
				new AbortController().signal,
			);
			expect(calls[0]).toBe("http://127.0.0.1:11432/v1/messages/sid/events");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	test("non-2xx throws (404 disabled/evicted)", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response("not found", { status: 404 })) as unknown as typeof fetch;
		try {
			await expect(
				resumeStreamFetch(
					"sid",
					"sid:1",
					"http://127.0.0.1:11432",
					{},
					new AbortController().signal,
				),
			).rejects.toThrow(/404/);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	test("no body -> throws", async () => {
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(null, { status: 200 })) as unknown as typeof fetch;
		try {
			await expect(
				resumeStreamFetch(
					"sid",
					"sid:1",
					"http://127.0.0.1:11432",
					{},
					new AbortController().signal,
				),
			).rejects.toThrow(/no body/);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	test("empty cursor -> no Last-Event-ID header", async () => {
		const calls: Array<{ headers: Record<string, string> }> = [];
		const origFetch = globalThis.fetch;
		globalThis.fetch = (async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const headers: Record<string, string> = {};
			if (init?.headers) {
				const h = new Headers(init.headers);
				h.forEach((v, k) => {
					headers[k] = v;
				});
			}
			calls.push({ headers });
			return new Response(makeStream(["data: ok\n\n"]), { status: 200 });
		}) as typeof fetch;
		try {
			await resumeStreamFetch(
				"sid",
				"",
				"http://127.0.0.1:11432",
				{},
				new AbortController().signal,
			);
			expect(calls[0].headers["last-event-id"]).toBeUndefined();
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});

// ─── isResumeEligibleError ───────────────────────────────────

describe("isResumeEligibleError", () => {
	test("timeout-class error -> true", () => {
		expect(
			isResumeEligibleError(new Error("Idle timeout: no data"), false),
		).toBe(true);
		expect(
			isResumeEligibleError(new Error("stream timeout reached"), false),
		).toBe(true);
		const t = new Error("x");
		t.name = "StallTimeoutError";
		expect(isResumeEligibleError(t, false)).toBe(true);
	});

	test("streamIdleAborted=true -> true (even if msg no timeout)", () => {
		expect(isResumeEligibleError(new Error("watchdog idle abort"), true)).toBe(
			true,
		);
	});

	test("non-Error -> false", () => {
		expect(isResumeEligibleError("string err", false)).toBe(false);
		expect(isResumeEligibleError(null, false)).toBe(false);
		expect(isResumeEligibleError(undefined, false)).toBe(false);
	});

	test("plain Error (not timeout, not idle) -> false", () => {
		expect(isResumeEligibleError(new Error("random failure"), false)).toBe(
			false,
		);
	});

	test("APIError-shaped 4xx (not timeout) -> false", () => {
		const apiErr = new Error("Request failed with 429");
		apiErr.name = "APIError";
		expect(isResumeEligibleError(apiErr, false)).toBe(false);
	});

	test("abort error (not idle) -> false", () => {
		const abortErr = new Error("Request was aborted.");
		abortErr.name = "AbortError";
		expect(isResumeEligibleError(abortErr, false)).toBe(false);
	});
});

// ─── gate (isStreamResumeEnabled / maxAttempts) ──────────────

describe("gate", () => {
	test("default off -> isStreamResumeEnabled() false", () => {
		delete process.env.FUSION_CODE_STREAM_RESUME_ENABLED;
		expect(isStreamResumeEnabled()).toBe(false);
	});

	test("=1 / true -> true", () => {
		setEnv("FUSION_CODE_STREAM_RESUME_ENABLED", "1");
		expect(isStreamResumeEnabled()).toBe(true);
		setEnv("FUSION_CODE_STREAM_RESUME_ENABLED", "true");
		expect(isStreamResumeEnabled()).toBe(true);
	});

	test("=0 / false -> false", () => {
		setEnv("FUSION_CODE_STREAM_RESUME_ENABLED", "0");
		expect(isStreamResumeEnabled()).toBe(false);
		setEnv("FUSION_CODE_STREAM_RESUME_ENABLED", "false");
		expect(isStreamResumeEnabled()).toBe(false);
	});

	test("maxAttempts default 3", () => {
		delete process.env.FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS;
		expect(maxAttempts()).toBe(3);
	});

	test("maxAttempts custom", () => {
		setEnv("FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS", "5");
		expect(maxAttempts()).toBe(5);
	});

	test("maxAttempts invalid -> default 3", () => {
		setEnv("FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS", "abc");
		expect(maxAttempts()).toBe(3);
		setEnv("FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS", "0");
		expect(maxAttempts()).toBe(3);
		setEnv("FUSION_CODE_STREAM_RESUME_MAX_ATTEMPTS", "-2");
		expect(maxAttempts()).toBe(3);
	});
});

// ─── ResumeRefs WeakMap ──────────────────────────────────────

describe("ResumeRefs WeakMap", () => {
	test("attach + get round-trip", () => {
		const resp = new Response(null);
		const refs = {
			cursorRef: { current: "s:3" },
			stateRef: { current: undefined },
			sid: "s",
			baseUrl: "http://x",
			authHeaders: {},
		};
		attachResumeRefs(resp, refs);
		expect(getResumeRefs(resp)).toBe(refs);
	});

	test("get on unattached -> undefined", () => {
		expect(getResumeRefs(new Response(null))).toBeUndefined();
	});
});

// ─── end-to-end merge (state-continuation crux) ──────────────

describe("end-to-end state-continuation merge", () => {
	test("pre-drop text 'Hello' + resumed ' world' -> delta ' world' only, no dup message_start, block stays", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: null,
			textBlockOpen: true,
			thinkingBlockOpen: false,
			textBuffer: "Hello",
			emittedTextLen: 5,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [{ delta: { content: " world" }, index: 0 }],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
			}),
		]);
		const parts = await collectParts(
			mergeResumedStream(resumed, "test-model", seed),
		);
		const types = parts.map((p) => (p as { type: string }).type);
		// 无重复 message_start
		expect(types).not.toContain("message_start");
		// 无新 content_block_start (续同块)
		expect(types).not.toContain("content_block_start");
		// 文本只发新部分
		const text = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { text?: string } }).delta.text,
			)
			.map((p) => (p as { delta: { text: string } }).delta.text)
			.join("");
		expect(text).toBe(" world");
		// 块索引保持预掉线值 (contentIndex-1 = 0)
		const deltaEvents = parts.filter(
			(p) => (p as { type: string }).type === "content_block_delta",
		);
		expect((deltaEvents[0] as { index: number }).index).toBe(0);
	});

	test("mid-tool seed + resumed args -> final input {cmd:'ls -l'}, id/name preserved", async () => {
		const seed = {
			messageId: "msg_pre",
			model: "test-model",
			contentIndex: 1,
			currentToolCall: {
				index: 0,
				id: "tool_1",
				name: "Bash",
				arguments: '{"cmd":"ls',
			},
			textBlockOpen: false,
			thinkingBlockOpen: false,
			textBuffer: "",
			emittedTextLen: 0,
			holdMode: false,
			holdTrigger: null,
			toolCalls: [],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
			finishReason: null,
		};
		const resumed = sseResponse([
			openaiSseChunk("s", 1, {
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: ' -l"}' } }],
						},
						index: 0,
					},
				],
			}),
			openaiSseChunk("s", 2, {
				choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
			}),
		]);
		const stateRef = { current: undefined };
		const parts = await collectParts(
			transformMLXStreamToAnthropic(
				resumed,
				"test-model",
				undefined,
				seed,
				stateRef,
			),
		);
		// finish_reason=tool_calls 关块后 currentToolCall=null (正常收尾),
		// 故断言 emitted arg deltas (种子 id/name 在块开时已固, 续传只发 args append)。
		const argDeltas = parts
			.filter(
				(p) =>
					(p as { type: string }).type === "content_block_delta" &&
					(p as { delta: { partial_json?: string } }).delta.partial_json !==
						undefined,
			)
			.map((p) => (p as { delta: { partial_json: string } }).delta.partial_json)
			.join("");
		expect(argDeltas).toBe(' -l"}');
		// 收尾关块后 currentToolCall 被 null (正常), args 已在块上累加完。
		expect(stateRef.current).toBeDefined();
		// 无新 content_block_start (mid-tool 续, 块已开)
		expect(parts.map((p) => (p as { type: string }).type)).not.toContain(
			"content_block_start",
		);
	});
});
