/**
 * Project-level API server — exposes project context, sessions, memory
 * via HTTP for Fusion Studio integration.
 *
 * Uses Bun.serve() for zero-dependency HTTP + WebSocket.
 * All endpoints accept `cwd` query param to resolve project paths.
 *
 * WebSocket /ws/chat — streaming chat via fusion-code CLI subprocess.
 * Protocol matches Fusion-Studio StreamingBridge (NDJSON):
 *   Client → Server: { "action": "chat.stream", "session_id": "...", "message": "..." }
 *   Server → Client: { "type": "chat_event", "session_id": "...", "event": {...} }
 *   Server → Client: { "type": "chat_done", "session_id": "..." }
 */

import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { scanMemoryFiles } from "../memdir/memoryScan.js";
import { getProjectContextPortable } from "../utils/claudemdPortable.js";
import { logForDebugging } from "../utils/debug.js";
import {
	listSessionsImpl,
	parseSessionInfoFromLite,
} from "../utils/listSessionsImpl.js";
import {
	readSessionLite,
	resolveSessionFilePath,
	sanitizePath,
	validateUuid,
} from "../utils/sessionStoragePortable.js";
import type { ServerConfig } from "./types.js";

type RouteHandler = (
	url: URL,
	body: Record<string, unknown> | null,
	pathParams?: Map<string, string>,
) => Promise<Response>;

const routes = new Map<string, RouteHandler>();

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

function getCwdFromUrl(url: URL): string {
	return url.searchParams.get("cwd") ?? process.cwd();
}

// GET /api/project/context
routes.set("/api/project/context", async (url) => {
	const cwd = getCwdFromUrl(url);
	try {
		const context = await getProjectContextPortable(cwd);
		return jsonResponse(context);
	} catch (e) {
		logForDebugging(`projectApiServer: /api/project/context error: ${e}`);
		return errorResponse("Failed to load project context", 500);
	}
});

// GET /api/sessions
routes.set("/api/sessions", async (url) => {
	const cwd = getCwdFromUrl(url);
	const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
	const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
	try {
		const sessions = await listSessionsImpl({
			dir: cwd,
			limit: Math.min(limit, 200),
			offset,
		});
		return jsonResponse({ sessions, total: sessions.length });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/sessions error: ${e}`);
		return errorResponse("Failed to list sessions", 500);
	}
});

// GET /api/sessions/:id
routes.set("/api/sessions/:id", async (url, _body, pathParams) => {
	const sessionId = pathParams?.get("id");
	if (!sessionId || !validateUuid(sessionId)) {
		return errorResponse("Invalid session ID", 400);
	}
	const cwd = getCwdFromUrl(url);
	try {
		const resolved = await resolveSessionFilePath(sessionId, cwd || undefined);
		if (!resolved) {
			return errorResponse("Session not found", 404);
		}
		const lite = await readSessionLite(resolved.filePath);
		if (!lite) {
			return errorResponse("Session not found", 404);
		}
		const info = parseSessionInfoFromLite(
			sessionId,
			lite,
			resolved.projectPath,
		);
		if (!info) {
			return errorResponse("Session not found", 404);
		}
		return jsonResponse(info);
	} catch (e) {
		logForDebugging(`projectApiServer: /api/sessions/:id error: ${e}`);
		return errorResponse("Failed to read session", 500);
	}
});

// GET /api/memory
routes.set("/api/memory", async (url) => {
	const cwd = getCwdFromUrl(url);
	const configHome =
		process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
	const memoryDir = join(configHome, "projects", sanitizePath(cwd), "memory");
	try {
		const controller = new AbortController();
		const memories = await scanMemoryFiles(memoryDir, controller.signal);
		return jsonResponse({ memories, cwd });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/memory GET error: ${e}`);
		return errorResponse("Failed to scan memory", 500);
	}
});

// POST /api/memory
routes.set("POST /api/memory", async (url, body) => {
	if (!body || typeof body !== "object") {
		return errorResponse("Request body required", 400);
	}
	const { filename, content, type } = body as Record<string, string>;
	if (!filename || !content) {
		return errorResponse("filename and content are required", 400);
	}
	if (filename.includes("..") || filename.includes("/")) {
		return errorResponse("filename must not contain .. or /", 400);
	}
	const cwd = getCwdFromUrl(url);
	const configHome =
		process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
	const memoryDir = join(configHome, "projects", sanitizePath(cwd), "memory");
	const filePath = join(memoryDir, filename);
	try {
		await mkdir(dirname(filePath), { recursive: true });
		const frontmatter = `---\nname: ${filename.replace(".md", "")}\ndescription: Auto-saved via API\ntype: ${type || "project"}\n---\n\n`;
		await writeFile(filePath, frontmatter + content, "utf-8");
		return jsonResponse({ ok: true, path: filePath });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/memory POST error: ${e}`);
		return errorResponse("Failed to write memory file", 500);
	}
});

function matchRoute(
	pathname: string,
	method: string,
): { handler: RouteHandler; pathParams: Map<string, string> } | null {
	// Try exact match first (with method prefix for POST)
	const methodKey = method === "POST" ? `POST ${pathname}` : pathname;
	const exact = routes.get(methodKey);
	if (exact) return { handler: exact, pathParams: new Map() };

	// Try parameterized match (e.g., /api/sessions/:id)
	for (const [pattern, handler] of routes) {
		const cleanPattern = pattern.startsWith("POST ")
			? pattern.slice(5)
			: pattern;
		const patternParts = cleanPattern.split("/");
		const pathParts = pathname.split("/");
		if (patternParts.length !== pathParts.length) continue;

		const params = new Map<string, string>();
		let match = true;
		for (let i = 0; i < patternParts.length; i++) {
			if (patternParts[i].startsWith(":")) {
				params.set(patternParts[i].slice(1), pathParts[i]);
			} else if (patternParts[i] !== pathParts[i]) {
				match = false;
				break;
			}
		}
		if (match) return { handler, pathParams: params };
	}
	return null;
}

// ─── WebSocket chat handler ──────────────────────────────────────
// Spawns `fusion-code -p "..." --output-format=stream-json` as subprocess,
// converts each NDJSON line → chat_event, sends to WS client.

type WsChatState = {
	sessionId: string;
	cwd: string;
	proc: ReturnType<typeof Bun.spawn> | null;
};

const wsSessions = new Map<WebSocket, WsChatState>();

function findFusionCodeBinary(): string {
	const candidates = [
		process.execPath,
		resolve(import.meta.dir, "../../fusion-code"),
		resolve(import.meta.dir, "../../fusion-code-dev"),
		resolve(process.cwd(), "fusion-code"),
		resolve(process.cwd(), "fusion-code-dev"),
	];
	for (const c of candidates) {
		try {
			const s = Bun.file(c);
			if (s.size > 0) {
				logForDebugging(`projectApiServer WS: found binary at ${c}`);
				return c;
			}
		} catch {
			/* skip */
		}
	}
	logForDebugging("projectApiServer WS: no binary found, falling back to PATH");
	return "fusion-code";
}

function handleChatStream(ws: WebSocket, data: Record<string, unknown>) {
	const sessionId = (data.session_id as string) || crypto.randomUUID();
	const message = data.message as string;
	const cwd = (data.cwd as string) || process.cwd();
	const model = data.model as string | undefined;

	if (!message || typeof message !== "string") {
		ws.send(
			JSON.stringify({
				type: "error",
				session_id: sessionId,
				message: "message is required",
			}),
		);
		return;
	}

	const existing = wsSessions.get(ws);
	if (existing?.proc) {
		try {
			existing.proc.kill();
		} catch {
			/* already dead */
		}
	}

	const binary = findFusionCodeBinary();
	const args = [
		"-p",
		message,
		"--output-format",
		"stream-json",
		"--verbose",
		"--cwd",
		cwd,
	];
	if (model) {
		args.push("--model", model);
	}
	if (config_global.authToken) {
		args.push("--auth", config_global.authToken);
	}

	logForDebugging(`projectApiServer WS: spawning ${binary} ${args.join(" ")}`);

	const proc = Bun.spawn([binary, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			FUSION_CODE_CONFIG_DIR: process.env.FUSION_CODE_CONFIG_DIR,
		},
		cwd,
	});

	wsSessions.set(ws, { sessionId, cwd, proc });

	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();

	(async () => {
		let buffer = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const sdkMsg = JSON.parse(line);
						ws.send(
							JSON.stringify({
								type: "chat_event",
								session_id: sessionId,
								event: {
									type: sdkMsg.type || "unknown",
									content:
										sdkMsg.delta ||
										sdkMsg.result ||
										sdkMsg.message?.content
											?.map((b: Record<string, unknown>) => b.text)
											.filter(Boolean)
											.join("") ||
										"",
									name: sdkMsg.tool_name || "",
									args: sdkMsg.tool_input || {},
									timestamp: Date.now(),
								},
							}),
						);
					} catch {
						ws.send(
							JSON.stringify({
								type: "chat_event",
								session_id: sessionId,
								event: { type: "raw", content: line, timestamp: Date.now() },
							}),
						);
					}
				}
			}
		} catch (e) {
			logForDebugging(`projectApiServer WS: read error: ${e}`);
		} finally {
			ws.send(JSON.stringify({ type: "chat_done", session_id: sessionId }));
			wsSessions.delete(ws);
			try {
				proc.kill();
			} catch {
				/* already dead */
			}
		}
	})();
}

function handleChatCancel(ws: WebSocket, data: Record<string, unknown>) {
	const state = wsSessions.get(ws);
	if (state?.proc) {
		try {
			state.proc.kill();
		} catch {
			/* already dead */
		}
		logForDebugging(
			`projectApiServer WS: cancelled session ${state.sessionId}`,
		);
	}
}

// Store config globally so WS handlers can access authToken
let config_global: ServerConfig = {
	port: 4827,
	host: "127.0.0.1",
	authToken: "",
};

export function startProjectApiServer(config: ServerConfig): {
	port: number;
	stop: () => void;
} {
	config_global = config;

	const server = Bun.serve({
		port: config.port,
		hostname: config.host || "127.0.0.1",
		websocket: {
			open(ws) {
				logForDebugging("projectApiServer WS: client connected");
			},
			message(ws, message) {
				try {
					const raw =
						typeof message === "string"
							? message
							: new TextDecoder().decode(message as Uint8Array);
					const data = JSON.parse(raw) as Record<string, unknown>;
					switch (data.action) {
						case "chat.stream":
							handleChatStream(ws, data);
							break;
						case "chat.cancel":
							handleChatCancel(ws, data);
							break;
						default:
							ws.send(
								JSON.stringify({
									type: "error",
									message: `Unknown action: ${data.action}`,
								}),
							);
					}
				} catch (e) {
					logForDebugging(`projectApiServer WS: parse error: ${e}`);
					ws.send(
						JSON.stringify({
							type: "error",
							message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
						}),
					);
				}
			},
			close(ws) {
				const state = wsSessions.get(ws);
				if (state?.proc) {
					try {
						state.proc.kill();
					} catch {
						/* already dead */
					}
				}
				wsSessions.delete(ws);
				logForDebugging("projectApiServer WS: client disconnected");
			},
		},
		async fetch(req) {
			const url = new URL(req.url);
			const method = req.method;

			// WebSocket upgrade for /ws/chat
			if (
				url.pathname === "/ws/chat" &&
				req.headers.get("upgrade") === "websocket"
			) {
				logForDebugging("projectApiServer: WS upgrade request for /ws/chat");
				const upgraded = server.upgrade(req);
				if (!upgraded) {
					return errorResponse("WebSocket upgrade failed", 500);
				}
				return upgraded as unknown as Response;
			}

			// CORS headers for Fusion Studio
			if (method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers": "Content-Type, Authorization",
					},
				});
			}

			// Auth check
			if (config.authToken) {
				const auth = req.headers.get("Authorization");
				if (auth !== `Bearer ${config.authToken}`) {
					return errorResponse("Unauthorized", 401);
				}
			}

			const matched = matchRoute(url.pathname, method);
			if (!matched) {
				return errorResponse("Not found", 404);
			}

			let body: Record<string, unknown> | null = null;
			if (method === "POST") {
				try {
					body = (await req.json()) as Record<string, unknown>;
				} catch {
					return errorResponse("Invalid JSON body", 400);
				}
			}

			try {
				const response = await matched.handler(url, body, matched.pathParams);
				// Add CORS headers to all responses
				response.headers.set("Access-Control-Allow-Origin", "*");
				return response;
			} catch (e) {
				logForDebugging(`projectApiServer: unhandled error: ${e}`);
				return errorResponse("Internal server error", 500);
			}
		},
	});

	logForDebugging(
		`projectApiServer: listening on ${config.host || "127.0.0.1"}:${server.port}`,
	);

	return {
		port: server.port,
		stop: () => server.stop(),
	};
}
