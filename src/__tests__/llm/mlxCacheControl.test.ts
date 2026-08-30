// audit §1.3.1: cache_control preserve through MLX adapter translation 单测.
//
// anthropicToMlxMessages 是模块内部函数, 通过导出的生产路径拦截器 createFusionMlxFetch
// 测试 (即 div-anthropic seam 里的 /v1/messages → /v1/chat/completions 转译路径).
// mock globalThis.fetch 做 URL 分支:
//   - /v1/models         → 空模型列表 (getMlxModelCapabilities 走纯 id 启发式, 不触发 getRecommendedCodeModel)
//   - /v1/chat/completions → 捕获 POST body 用于断言, 返最小 MLXChatCompletionResponse
// 用纯文本模型 id (无 image 关键词) 跳过 getRecommendedCodeModel 路径.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	_resetOriginalFetch,
	clearMlxCapabilitiesCache,
	createFusionMlxFetch,
} from "../../services/api/index.js";

type CapturedBody = {
	messages: Array<{
		role: string;
		content: string | Array<Record<string, unknown>>;
		cache_control?: Record<string, string>;
	}>;
};

function mlxOkResponse(): Response {
	return new Response(
		JSON.stringify({
			id: "cmpl-test",
			object: "chat.completion",
			created: 1,
			model: "qwen3-coder-1.5b",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "ok" },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 4,
				completion_tokens: 1,
				total_tokens: 5,
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function emptyModelsResponse(): Response {
	return new Response(JSON.stringify({ object: "list", data: [] }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function installMockFetch(onChat: (body: CapturedBody) => void): () => void {
	const origFetch = globalThis.fetch;
	globalThis.fetch = (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.includes("/v1/models")) {
			return emptyModelsResponse();
		}
		if (url.includes("/v1/chat/completions")) {
			const raw = init?.body ? JSON.parse(init.body as string) : {};
			onChat(raw as CapturedBody);
			return mlxOkResponse();
		}
		// 透传兜底 (不应命中)
		return new Response(JSON.stringify({}), { status: 200 });
	}) as typeof fetch;
	return () => {
		globalThis.fetch = origFetch;
	};
}

async function postMessages(
	body: Record<string, unknown>,
): Promise<{ messages: CapturedBody["messages"] }> {
	let captured: CapturedBody = { messages: [] };
	const restore = installMockFetch((b) => {
		captured = b;
	});
	try {
		const fetchFn = createFusionMlxFetch("qwen3-coder-1.5b");
		await fetchFn("http://127.0.0.1:11432/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ stream: false, max_tokens: 16, ...body }),
		});
	} finally {
		restore();
	}
	return { messages: captured.messages };
}

beforeEach(() => {
	_resetOriginalFetch();
	clearMlxCapabilitiesCache();
});

afterEach(() => {
	_resetOriginalFetch();
	clearMlxCapabilitiesCache();
});

describe("anthropicToMlxMessages cache_control preserve (audit §1.3.1)", () => {
	test("system array WITH cache_control → message-level cache_control preserved, text joined", async () => {
		const { messages } = await postMessages({
			system: [
				{
					type: "text",
					text: "static-prefix",
					cache_control: { type: "ephemeral" },
				},
				{ type: "text", text: "dynamic-suffix" },
			],
			messages: [{ role: "user", content: "hi" }],
		});
		const sys = messages.find((m) => m.role === "system");
		expect(sys).toBeDefined();
		expect(sys?.content).toBe("static-prefix\ndynamic-suffix");
		expect(sys?.cache_control).toEqual({ type: "ephemeral" });
	});

	test("system array WITHOUT cache_control → no cache_control key (byte-identical to today)", async () => {
		const { messages } = await postMessages({
			system: [
				{ type: "text", text: "plain-sys-1" },
				{ type: "text", text: "plain-sys-2" },
			],
			messages: [{ role: "user", content: "hi" }],
		});
		const sys = messages.find((m) => m.role === "system");
		expect(sys).toBeDefined();
		expect(sys?.content).toBe("plain-sys-1\nplain-sys-2");
		expect("cache_control" in (sys ?? {})).toBe(false);
	});

	test("system string (no array) → no cache_control", async () => {
		const { messages } = await postMessages({
			system: "just-a-string-sys",
			messages: [{ role: "user", content: "hi" }],
		});
		const sys = messages.find((m) => m.role === "system");
		expect(sys).toBeDefined();
		expect(sys?.content).toBe("just-a-string-sys");
		expect("cache_control" in (sys ?? {})).toBe(false);
	});

	test("DYNAMIC_BOUNDARY split WITH cache_control → split message still carries message-level cache_control", async () => {
		const { messages } = await postMessages({
			system: [
				{
					type: "text",
					text: `static-part-1SYSTEM_PROMPT_DYNAMIC_BOUNDARYdynamic-part-2`,
					cache_control: { type: "ephemeral", ttl: "5m" },
				},
			],
			messages: [{ role: "user", content: "hi" }],
		});
		const sys = messages.find((m) => m.role === "system");
		expect(sys).toBeDefined();
		// static + "\n" + dynamic concatenation, both trimmed
		expect(sys?.content).toBe("static-part-1\ndynamic-part-2");
		expect(sys?.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
	});

	test("content block (user msg) WITH cache_control → part-level cache_control preserved, text unchanged", async () => {
		const { messages } = await postMessages({
			system: "sys",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "cached-block",
							cache_control: { type: "ephemeral" },
						},
					],
				},
			],
		});
		const user = messages.find((m) => m.role === "user");
		expect(user).toBeDefined();
		const parts = user?.content as Array<Record<string, unknown>>;
		expect(parts[0].type).toBe("text");
		expect(parts[0].text).toBe("cached-block");
		expect(parts[0].cache_control).toEqual({ type: "ephemeral" });
	});

	test("content block WITHOUT cache_control → no cache_control key (byte-identical)", async () => {
		const { messages } = await postMessages({
			system: "sys",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "plain-block" }],
				},
			],
		});
		const user = messages.find((m) => m.role === "user");
		expect(user).toBeDefined();
		const parts = user?.content as Array<Record<string, unknown>>;
		expect(parts[0].type).toBe("text");
		expect(parts[0].text).toBe("plain-block");
		expect("cache_control" in parts[0]).toBe(false);
	});

	test("end-to-end: Anthropic /v1/messages body with cached system block → POSTed /v1/chat/completions body system msg carries cache_control", async () => {
		const { messages } = await postMessages({
			system: [
				{
					type: "text",
					text: "big-static-prefix",
					cache_control: { type: "ephemeral" },
				},
			],
			messages: [
				{ role: "user", content: "turn-1" },
				{ role: "assistant", content: "resp-1" },
				{ role: "user", content: "turn-2" },
			],
		});
		// marker must reach the chat-completions body (proof it reaches fusion-mlx)
		const sys = messages.find((m) => m.role === "system");
		expect(sys?.cache_control).toEqual({ type: "ephemeral" });
		expect(sys?.content).toBe("big-static-prefix");
		// user/assistant messages survive unchanged in role order
		const roles = messages.map((m) => m.role);
		expect(roles).toEqual(["system", "user", "assistant", "user"]);
	});
});
