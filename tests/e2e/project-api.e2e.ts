// projectApiServer e2e 验收 — 真实服务 (start.sh, 11441) + 真实 MLX 模型。
// HTTP 契约用 request fixture; CORS/WS 用真实 Chromium 页面 (page.evaluate)。
// WS chat.stream 起真实 fusion-code CLI 子进程, 走 FUSION_MLX_ENABLED 直连本地模型。
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { E2E_MODEL, E2E_TOKEN } from "./playwright.config.js";

const BASE = "http://127.0.0.1:11441";

const TEST_CWD = `/tmp/fusion-e2e-${Date.now()}`;
const MISSING_UUID = "00000000-0000-0000-0000-000000000000";

type WsResult = {
	opened: boolean;
	status: number | null;
	messages: Array<Record<string, unknown>>;
	closeCode: number | null;
};

// 浏览器内开 WS, 收集消息直到 stopWhen 命中或超时
async function wsCollect(
	page: Page,
	payload: string | Record<string, unknown>,
	stopWhen: (msg: Record<string, unknown>) => boolean,
	timeoutMs: number,
	token = E2E_TOKEN,
): Promise<WsResult> {
	return page.evaluate(
		([payloadStr, stopSrc, timeoutMs, token]) => {
			const stopWhen = new Function("m", `return (${stopSrc})(m);`) as (
				m: Record<string, unknown>,
			) => boolean;
			return new Promise((resolve) => {
				const messages: Array<Record<string, unknown>> = [];
				const ws = new WebSocket(`ws://127.0.0.1:11441/ws/chat?token=${token}`);
				const finish = (status: number | null, closeCode: number | null) => {
					resolve({ opened, status, messages, closeCode });
				};
				let opened = false;
				const timer = setTimeout(() => {
					try {
						ws.close();
					} catch {
						/* noop */
					}
					finish(null, null);
				}, timeoutMs);
				ws.onopen = () => {
					opened = true;
					ws.send(
						typeof payloadStr === "string"
							? payloadStr
							: JSON.stringify(payloadStr),
					);
				};
				ws.onerror = () => {
					/* handshake 失败: onclose 兜底 */
				};
				ws.onclose = (ev) => {
					clearTimeout(timer);
					finish(null, ev.code);
				};
				ws.onmessage = (ev) => {
					let parsed: Record<string, unknown> = {};
					try {
						parsed = JSON.parse(ev.data as string);
					} catch {
						parsed = { raw: ev.data };
					}
					messages.push(parsed);
					if (stopWhen(parsed)) {
						clearTimeout(timer);
						try {
							ws.close();
						} catch {
							/* noop */
						}
					}
				};
			});
		},
		[
			typeof payload === "string" ? payload : JSON.stringify(payload),
			stopWhen.toString(),
			timeoutMs,
			token,
		] as [string, string, number, string],
	);
}

test.beforeAll(async () => {
	await mkdir(TEST_CWD, { recursive: true });
	await writeFile(
		`${TEST_CWD}/CLAUDE.md`,
		"---\ndescription: E2E project\n---\n\nE2E instructions",
	);
});

test.afterAll(async () => {
	await rm(TEST_CWD, { recursive: true, force: true }).catch(() => {});
});

// ─── 认证 (Node fetch — request fixture 会继承 config 的 extraHTTPHeaders) ──
test("auth: missing token -> 401", async () => {
	const res = await fetch(`${BASE}/api/model/status`);
	expect(res.status).toBe(401);
});

test("auth: wrong token -> 401", async () => {
	const res = await fetch(`${BASE}/api/model/status`, {
		headers: { Authorization: "Bearer wrong-token" },
	});
	expect(res.status).toBe(401);
});

// ─── HTTP 契约 ────────────────────────────────────────────────────
test("GET /api/project/context returns project files", async ({ request }) => {
	const res = await request.get(
		`/api/project/context?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(data.cwd).toBe(TEST_CWD);
	expect(Array.isArray(data.files)).toBe(true);
	const claudeMd = data.files.find(
		(f: { path: string }) => f.path === `${TEST_CWD}/CLAUDE.md`,
	);
	expect(claudeMd?.type).toBe("Project");
});

test("GET /api/projects returns list", async ({ request }) => {
	const res = await request.get("/api/projects");
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(Array.isArray(data.projects)).toBe(true);
	expect(data.total).toBe(data.projects.length);
});

test("GET /api/sessions returns session list", async ({ request }) => {
	const res = await request.get(
		`/api/sessions?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(Array.isArray(data.sessions)).toBe(true);
});

test("GET /api/sessions/:id invalid UUID -> 400", async ({ request }) => {
	const res = await request.get(
		`/api/sessions/not-a-uuid?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(400);
	const data = await res.json();
	expect(String(data.error)).toContain("Invalid session ID");
});

test("GET /api/sessions/:id missing UUID -> 404", async ({ request }) => {
	const res = await request.get(
		`/api/sessions/${MISSING_UUID}?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(404);
});

test("GET /api/memory returns memories", async ({ request }) => {
	const res = await request.get(
		`/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(Array.isArray(data.memories)).toBe(true);
});

test("POST /api/memory writes memory file", async ({ request }) => {
	const res = await request.post(
		`/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
		{
			data: {
				filename: "e2e-memory.md",
				content: "e2e memory",
				type: "project",
			},
		},
	);
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(data.ok).toBe(true);
	expect(String(data.path)).toContain("e2e-memory.md");
});

test("POST /api/memory missing fields -> 400", async ({ request }) => {
	const res = await request.post(
		`/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
		{ data: { filename: "x.md" } },
	);
	expect(res.status()).toBe(400);
});

test("POST /api/memory path traversal -> 400", async ({ request }) => {
	const res = await request.post(
		`/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
		{ data: { filename: "../etc/passwd", content: "x" } },
	);
	expect(res.status()).toBe(400);
});

test("GET /api/model/status connected to local inference with models", async ({
	request,
}) => {
	const res = await request.get("/api/model/status");
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(data.connected).toBe(true);
	expect(Array.isArray(data.models)).toBe(true);
	expect(data.models.length).toBeGreaterThan(0);
});

test("GET /api/templates returns builtin + saved", async ({ request }) => {
	const res = await request.get(
		`/api/templates?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(200);
	const data = await res.json();
	expect(Array.isArray(data.builtin)).toBe(true);
	expect(Array.isArray(data.saved)).toBe(true);
	expect(data.total).toBe(data.builtin.length + data.saved.length);
});

test("GET /api/kb/status returns status", async ({ request }) => {
	const res = await request.get(
		`/api/kb/status?cwd=${encodeURIComponent(TEST_CWD)}`,
	);
	expect(res.status()).toBe(200);
});

test("POST /api/kb/query validation: missing query -> 400", async ({
	request,
}) => {
	const res = await request.post(
		`/api/kb/query?cwd=${encodeURIComponent(TEST_CWD)}`,
		{
			data: { topK: 5 },
		},
	);
	expect(res.status()).toBe(400);
});

test("POST /api/kb/query validation: bad topK -> 400", async ({ request }) => {
	const res = await request.post(
		`/api/kb/query?cwd=${encodeURIComponent(TEST_CWD)}`,
		{ data: { query: "x", topK: 999 } },
	);
	expect(res.status()).toBe(400);
});

test("POST /api/code/generate validation: missing prompt -> 400", async ({
	request,
}) => {
	const res = await request.post("/api/code/generate", {
		data: { language: "python" },
	});
	expect(res.status()).toBe(400);
	const data = await res.json();
	expect(String(data.error)).toContain("prompt is required");
});

test("POST /api/code/generate validation: missing language -> 400", async ({
	request,
}) => {
	const res = await request.post("/api/code/generate", {
		data: { prompt: "hello" },
	});
	expect(res.status()).toBe(400);
});

test("POST /api/lsp/operation validation: bad operation -> 400", async ({
	request,
}) => {
	const res = await request.post("/api/lsp/operation", {
		data: { operation: "nope", file_path: "/tmp/x.ts" },
	});
	expect(res.status()).toBe(400);
});

test("GET unknown route -> 404", async ({ request }) => {
	const res = await request.get("/api/does-not-exist");
	expect(res.status()).toBe(404);
});

// ─── CORS (真实浏览器 + 服务端 preflight) ─────────────────────────
test("OPTIONS preflight echoes origin + allows auth header", async ({
	request,
}) => {
	const res = await request.fetch("/api/project/context", {
		method: "OPTIONS",
		headers: { Origin: "http://studio.local" },
	});
	expect(res.status()).toBe(204);
	expect(res.headers()["access-control-allow-origin"]).toBe(
		"http://studio.local",
	);
	expect(res.headers()["access-control-allow-headers"]).toContain(
		"Authorization",
	);
});

test("browser same-origin fetch with token succeeds (server page)", async ({
	page,
}) => {
	// 404 JSON 页即可 — 页面 origin 变为服务 origin, 同源 fetch 无 CORS
	await page.goto(`${BASE}/`);
	const result = await page.evaluate(async (token) => {
		const res = await fetch("/api/model/status", {
			headers: { Authorization: `Bearer ${token}` },
		});
		return { status: res.status, connected: (await res.json()).connected };
	}, E2E_TOKEN);
	expect(result.status).toBe(200);
	expect(result.connected).toBe(true);
});

test("browser cross-origin fetch with token succeeds (real CORS preflight + ACAO)", async ({
	page,
}) => {
	// 从夹具 origin (11496) 跨源请求 11441 — Authorization 触发 preflight,
	// 服务端须回显 Origin 并允许 Authorization (Fusion Studio 场景)
	await page.goto("http://127.0.0.1:11496/");
	const result = await page.evaluate(
		async ([token, base]) => {
			const res = await fetch(`${base}/api/model/status`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			return { status: res.status, connected: (await res.json()).connected };
		},
		[E2E_TOKEN, BASE] as [string, string],
	);
	// CORS 失败时 fetch 会 reject; 200 + body 可读 = preflight/ACAO 全通过
	// (ACAO 头本身非 CORS-safelisted, 浏览器 JS 读不到, 不断言它)
	expect(result.status).toBe(200);
	expect(result.connected).toBe(true);
});

// ─── WebSocket: 协议错误路径 ───────────────────────────────────────
test("WS: invalid JSON -> Parse error", async ({ page }) => {
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		"not-json",
		(m) => m.type === "error",
		10_000,
	);
	expect(result.opened).toBe(true);
	const err = result.messages.find((m) => m.type === "error");
	expect(String(err?.message)).toContain("Parse error");
});

test("WS: chat.stream without message -> error", async ({ page }) => {
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		{ action: "chat.stream" },
		(m) => m.type === "error",
		10_000,
	);
	const err = result.messages.find((m) => m.type === "error");
	expect(String(err?.message)).toContain("message is required");
});

test("WS: unknown action -> error", async ({ page }) => {
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		{ action: "no.such.action" },
		(m) => m.type === "error",
		10_000,
	);
	const err = result.messages.find((m) => m.type === "error");
	expect(String(err?.message)).toContain("Unknown action");
});

test("WS: bad token -> connection rejected", async ({ page }) => {
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		{ action: "chat.cancel" },
		() => false,
		10_000,
		"wrong-token",
	);
	expect(result.opened).toBe(false);
});

test("WS: chat.cancel with no active session -> graceful", async ({ page }) => {
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		{ action: "chat.cancel" },
		() => false,
		5_000,
	);
	expect(result.opened).toBe(true);
	// 无崩溃断言: 收到 chat.cancel 的确认或连接保持后超时均可, 只要不是 error
	const errors = result.messages.filter((m) => m.type === "error");
	expect(errors).toEqual([]);
});

// ─── WebSocket: 真实模型端到端 ─────────────────────────────────────
test("WS chat.stream: real MLX model streams events then chat_done", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.goto(`${BASE}/`);
	const result = await wsCollect(
		page,
		{
			action: "chat.stream",
			message: "Reply with exactly the word E2E_OK and nothing else.",
			cwd: TEST_CWD,
			model: E2E_MODEL,
		},
		(m) => m.type === "chat_done",
		150_000,
	);
	expect(result.opened).toBe(true);
	const events = result.messages.filter((m) => m.type === "chat_event");
	expect(events.length).toBeGreaterThan(0);
	const contents = events
		.map((e) => String((e.event as Record<string, unknown>)?.content ?? ""))
		.join("");
	expect(contents.length).toBeGreaterThan(0);
	expect(result.messages.some((m) => m.type === "chat_done")).toBe(true);
});
