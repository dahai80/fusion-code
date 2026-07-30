/**
 * Tests for project-level API server endpoints.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { startProjectApiServer } from "../../src/server/projectApiServer.js";

const TEST_PORT = 14827;
const TEST_CWD = "/tmp/fusion-api-test-" + Date.now();

let baseUrl: string;
let stop: () => void;

describe("projectApiServer", () => {
	beforeEach(async () => {
		await mkdir(TEST_CWD, { recursive: true });
		await mkdir(join(TEST_CWD, ".fusion-code", "rules"), {
			recursive: true,
		});
		await writeFile(
			join(TEST_CWD, "CLAUDE.md"),
			"---\ndescription: Test project\n---\n\nTest instructions",
		);
		const instance = startProjectApiServer({
			port: TEST_PORT,
			host: "127.0.0.1",
			authToken: "",
		});
		baseUrl = `http://127.0.0.1:${instance.port}`;
		stop = instance.stop;
	});

	afterEach(async () => {
		stop();
		await rm(TEST_CWD, { recursive: true, force: true });
	});

	it("GET /api/project/context returns project files", async () => {
		const res = await fetch(
			`${baseUrl}/api/project/context?cwd=${encodeURIComponent(TEST_CWD)}`,
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.cwd).toBe(TEST_CWD);
		expect(Array.isArray(data.files)).toBe(true);
		expect(data.files.length).toBeGreaterThan(0);
		const claudeMd = data.files.find(
			(f: { path: string }) => f.path === join(TEST_CWD, "CLAUDE.md"),
		);
		expect(claudeMd).toBeDefined();
		expect(claudeMd.type).toBe("Project");
	});

	it("GET /api/sessions returns session list", async () => {
		const res = await fetch(
			`${baseUrl}/api/sessions?cwd=${encodeURIComponent(TEST_CWD)}`,
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.sessions)).toBe(true);
	});

	it("GET /api/sessions/:id with invalid UUID returns 400", async () => {
		const res = await fetch(
			`${baseUrl}/api/sessions/not-a-uuid?cwd=${encodeURIComponent(TEST_CWD)}`,
		);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("Invalid session ID");
	});

	it("GET /api/sessions/:id with valid but missing UUID returns 404", async () => {
		const res = await fetch(
			`${baseUrl}/api/sessions/00000000-0000-0000-0000-000000000000?cwd=${encodeURIComponent(TEST_CWD)}`,
		);
		expect(res.status).toBe(404);
	});

	it("GET /api/memory returns memory files", async () => {
		const res = await fetch(
			`${baseUrl}/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.memories)).toBe(true);
	});

	it("POST /api/memory writes a memory file", async () => {
		const res = await fetch(
			`${baseUrl}/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "test-memory.md",
					content: "Test memory content",
					type: "project",
				}),
			},
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.path).toContain("test-memory.md");
	});

	it("POST /api/memory with missing fields returns 400", async () => {
		const res = await fetch(
			`${baseUrl}/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: "test.md" }),
			},
		);
		expect(res.status).toBe(400);
	});

	it("POST /api/memory with path traversal returns 400", async () => {
		const res = await fetch(
			`${baseUrl}/api/memory?cwd=${encodeURIComponent(TEST_CWD)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "../etc/passwd",
					content: "hacked",
				}),
			},
		);
		expect(res.status).toBe(400);
	});

	it("GET unknown route returns 404", async () => {
		const res = await fetch(`${baseUrl}/api/unknown`);
		expect(res.status).toBe(404);
	});

	it("OPTIONS returns CORS headers", async () => {
		const res = await fetch(`${baseUrl}/api/project/context`, {
			method: "OPTIONS",
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	describe("WebSocket /ws/chat", () => {
		it("rejects WS connection with invalid JSON", async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/chat`);
			await new Promise<void>((resolve) => {
				ws.onopen = () => {
					ws.send("not-json");
					ws.onmessage = (ev) => {
						const data = JSON.parse(ev.data as string);
						expect(data.type).toBe("error");
						expect(data.message).toContain("Invalid JSON");
						ws.close();
						resolve();
					};
				};
			});
		});

		it("rejects chat.stream without message", async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/chat`);
			await new Promise<void>((resolve) => {
				ws.onopen = () => {
					ws.send(JSON.stringify({ action: "chat.stream" }));
					ws.onmessage = (ev) => {
						const data = JSON.parse(ev.data as string);
						expect(data.type).toBe("error");
						expect(data.message).toContain("message is required");
						ws.close();
						resolve();
					};
				};
			});
		});

		it("returns error for unknown action", async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/chat`);
			await new Promise<void>((resolve) => {
				ws.onopen = () => {
					ws.send(JSON.stringify({ action: "unknown.action" }));
					ws.onmessage = (ev) => {
						const data = JSON.parse(ev.data as string);
						expect(data.type).toBe("error");
						expect(data.message).toContain("Unknown action");
						ws.close();
						resolve();
					};
				};
			});
		});

		it("handles chat.cancel gracefully with no active session", async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/chat`);
			await new Promise<void>((resolve) => {
				ws.onopen = () => {
					ws.send(JSON.stringify({ action: "chat.cancel" }));
					ws.close();
					resolve();
				};
			});
		});

		it("upgrades to WebSocket on /ws/chat path", async () => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/chat`);
			await new Promise<void>((resolve) => {
				ws.onopen = () => {
					expect(ws.readyState).toBe(WebSocket.OPEN);
					ws.close();
					resolve();
				};
			});
		});
	});
});
