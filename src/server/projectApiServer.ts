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

import type { ServerWebSocket } from "bun";
import { randomBytes } from "crypto";
import { chmod, mkdir, readdir, writeFile } from "fs/promises";
import { chmodSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { scanMemoryFiles } from "../memdir/memoryScan.js";
import { getProjectContextPortable } from "../utils/claudemdPortable.js";
import { logForDebugging } from "../utils/debug.js";
import { isEnvTruthy } from "../utils/envUtils.js";
import {
	listSessionsImpl,
	parseSessionInfoFromLite,
} from "../utils/listSessionsImpl.js";
import {
	getProjectsDir,
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

// GET /api/projects — list all known projects
routes.set("/api/projects", async () => {
	const projectsDir = getProjectsDir();
	try {
		const entries = await readdir(projectsDir, { withFileTypes: true });
		const projects = entries
			.filter((e) => e.isDirectory())
			.map((e) => ({
				id: e.name,
				name: e.name.replace(/^-/, "").replace(/-/g, "/"),
				path: join(projectsDir, e.name),
			}));
		return jsonResponse({ projects, total: projects.length });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/projects error: ${e}`);
		return errorResponse("Failed to list projects", 500);
	}
});

// GET /api/projects/:id/context — project knowledge-base context
routes.set("/api/projects/:id/context", async (url, _body, pathParams) => {
	const projectId = pathParams?.get("id");
	if (!projectId) {
		return errorResponse("Missing project id", 400);
	}
	const projectsDir = getProjectsDir();
	const projectDir = join(projectsDir, projectId);
	try {
		const { stat } = await import("fs/promises");
		const s = await stat(projectDir);
		if (!s.isDirectory()) {
			return errorResponse("Project not found", 404);
		}
		const decodedName = projectId.replace(/^-/, "").replace(/-/g, "/");
		const context = await getProjectContextPortable(decodedName);
		return jsonResponse({ id: projectId, ...context });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/projects/:id/context error: ${e}`);
		return errorResponse("Project not found", 404);
	}
});

// GET /api/sessions
routes.set("/api/sessions", async (url) => {
	const cwd = getCwdFromUrl(url);
	const projectId = url.searchParams.get("project_id");
	const limit = Math.min(
		Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
		200,
	);
	const offset = Math.max(
		parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
		0,
	);
	try {
		const dir = projectId
			? projectId.replace(/^-/, "").replace(/-/g, "/")
			: cwd;
		const sessions = await listSessionsImpl({
			dir,
			limit,
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

// POST /api/code/generate — code generation via fusion-code subprocess
routes.set("POST /api/code/generate", async (_url, body) => {
	if (!body || typeof body !== "object") {
		return errorResponse("Request body required", 400);
	}
	const { prompt, language, context, max_tokens } = body as Record<
		string,
		unknown
	>;
	if (!prompt || typeof prompt !== "string") {
		return errorResponse("prompt is required", 400);
	}
	if (!language || typeof language !== "string") {
		return errorResponse("language is required", 400);
	}

	const allowedLangs = [
		"python",
		"bash",
		"javascript",
		"typescript",
		"swift",
		"rust",
		"go",
		"java",
		"c",
		"cpp",
	];
	if (!allowedLangs.includes((language as string).toLowerCase())) {
		return errorResponse(
			`language must be one of: ${allowedLangs.join(", ")}`,
			400,
		);
	}

	const sysPrompt = [
		`You are a code generator. Generate ONLY ${language} code.`,
		"Do NOT include markdown fences, explanations, or comments outside the code.",
		"Output raw code only, ready to execute.",
		context && typeof context === "string" ? `\nContext:\n${context}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const userPrompt =
		max_tokens && typeof max_tokens === "number"
			? `${prompt}\n\n(Keep response under ${max_tokens} tokens)`
			: String(prompt);

	const binary = findFusionCodeBinary();
	const args = [
		"-p",
		userPrompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--append-system-prompt",
		sysPrompt,
	];

	logForDebugging(`projectApiServer: /api/code/generate spawning ${binary}`);

	try {
		const proc = Bun.spawn([binary, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				FUSION_CODE_CONFIG_DIR: process.env.FUSION_CODE_CONFIG_DIR,
			},
		});

		const chunks: string[] = [];
		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let totalTokens = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const text = decoder.decode(value, { stream: true });
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line);
					const content =
						msg.delta ||
						msg.result ||
						msg.message?.content
							?.map((b: Record<string, unknown>) => b.text)
							.filter(Boolean)
							.join("") ||
						"";
					if (content) {
						chunks.push(content);
						totalTokens += 1;
					}
				} catch {
					chunks.push(line);
				}
			}
		}

		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			logForDebugging(
				`projectApiServer: /api/code/generate exited ${exitCode}`,
			);
		}

		const code = chunks.join("");
		return jsonResponse({
			code,
			language,
			explanation: "",
			tokens_used: totalTokens,
		});
	} catch (e) {
		logForDebugging(`projectApiServer: /api/code/generate error: ${e}`);
		return errorResponse("Code generation failed", 500);
	}
});

// POST /api/lsp/operation — LSP code intelligence
routes.set("POST /api/lsp/operation", async (_url, body) => {
	if (!body || typeof body !== "object") {
		return errorResponse("Request body required", 400);
	}
	const { operation, file_path, line, character, query } = body as Record<
		string,
		unknown
	>;

	const validOps = [
		"goToDefinition",
		"findReferences",
		"hover",
		"documentSymbol",
		"workspaceSymbol",
	];
	if (!operation || !validOps.includes(operation as string)) {
		return errorResponse(
			`operation must be one of: ${validOps.join(", ")}`,
			400,
		);
	}
	if (!file_path || typeof file_path !== "string") {
		return errorResponse("file_path is required", 400);
	}

	const op = operation as string;
	const needsPosition = ["goToDefinition", "findReferences", "hover"].includes(
		op,
	);
	if (needsPosition) {
		if (typeof line !== "number" || typeof character !== "number") {
			return errorResponse(
				"line and character are required for this operation",
				400,
			);
		}
	}

	try {
		const {
			getLspServerManager,
			waitForInitialization,
			getInitializationStatus,
		} = await import("../services/lsp/index.js");
		const { pathToFileURL } = await import("url");
		const { resolve: resolvePath } = await import("path");

		const status = getInitializationStatus();
		if (status.status === "pending") {
			try {
				await waitForInitialization();
			} catch {
				logForDebugging("projectApiServer: LSP initialization timed out");
			}
		}

		const manager = getLspServerManager();
		if (!manager) {
			return jsonResponse(
				{
					error: "LSP server manager not initialized",
					detail:
						"In API server mode, set FUSION_CODE_PROJECT_DIR env or pass cwd query param to initialize LSP.",
					status: "unavailable",
				},
				503,
			);
		}

		const absolutePath = resolvePath(String(file_path));
		const uri = pathToFileURL(absolutePath).href;

		let method: string;
		let params: Record<string, unknown>;

		switch (op) {
			case "goToDefinition":
				method = "textDocument/definition";
				params = {
					textDocument: { uri },
					position: {
						line: (line as number) - 1,
						character: (character as number) - 1,
					},
				};
				break;
			case "findReferences":
				method = "textDocument/references";
				params = {
					textDocument: { uri },
					position: {
						line: (line as number) - 1,
						character: (character as number) - 1,
					},
					context: { includeDeclaration: true },
				};
				break;
			case "hover":
				method = "textDocument/hover";
				params = {
					textDocument: { uri },
					position: {
						line: (line as number) - 1,
						character: (character as number) - 1,
					},
				};
				break;
			case "documentSymbol":
				method = "textDocument/documentSymbol";
				params = { textDocument: { uri } };
				break;
			case "workspaceSymbol":
				method = "workspace/symbol";
				params = { query: (query as string) || "" };
				break;
			default:
				return errorResponse(`Unsupported operation: ${op}`, 400);
		}

		// Open file in LSP if not already open
		if (!manager.isFileOpen(absolutePath)) {
			try {
				const { readFile } = await import("fs/promises");
				const content = await readFile(absolutePath, "utf-8");
				await manager.openFile(absolutePath, content);
			} catch {
				logForDebugging(
					`projectApiServer LSP: could not open file ${absolutePath}`,
				);
			}
		}

		const result = await manager.sendRequest(absolutePath, method, params);
		if (result === undefined) {
			return errorResponse("No LSP server available for file type", 404);
		}

		const results = formatLspResult(op, result);
		return jsonResponse({ operation: op, results });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/lsp/operation error: ${e}`);
		return errorResponse("LSP operation failed", 500);
	}
});

function formatLspResult(
	operation: string,
	result: unknown,
): Array<Record<string, unknown>> {
	if (!result) return [];
	if (Array.isArray(result)) {
		return result
			.map((item: Record<string, unknown>) => extractLspLocation(item))
			.filter(Boolean) as Array<Record<string, unknown>>;
	}
	if (typeof result === "object" && result !== null) {
		const r = result as Record<string, unknown>;
		if (operation === "hover" && typeof r.contents === "object") {
			const contents = r.contents as Record<string, unknown>;
			return [
				{
					text: String(contents.value || JSON.stringify(r.contents)),
					kind: "hover",
				},
			];
		}
		if (operation === "hover" && typeof r.contents === "string") {
			return [{ text: r.contents, kind: "hover" }];
		}
		const loc = extractLspLocation(r);
		return loc ? [loc] : [];
	}
	return [{ text: String(result), kind: "raw" }];
}

function extractLspLocation(
	item: Record<string, unknown>,
): Record<string, unknown> | null {
	if (!item || typeof item !== "object") return null;
	const uri = (item.uri as string) || (item.targetUri as string) || "";
	const range =
		(item.range as Record<string, unknown>) ||
		(item.targetRange as Record<string, unknown>);
	const start =
		range && typeof range === "object"
			? ((range as Record<string, unknown>).start as Record<string, number>)
			: undefined;
	return {
		file_path: uri.replace("file://", ""),
		line: start?.line != null ? start.line + 1 : 0,
		character: start?.character != null ? start.character + 1 : 0,
		text: String(item.name || item.message || ""),
		kind: String(item.kind || ""),
	};
}

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

// GET /api/model/status — local MLX model load and status (#38, #39)
routes.set("/api/model/status", async () => {
	const MLX_BASE =
		process.env.FUSION_GATEWAY_URL ||
		process.env.FUSION_MLX_BASE_URL ||
		"http://127.0.0.1:11432";
	const mlxApiKey =
		process.env.FUSION_API_KEY || process.env.ANTHROPIC_API_KEY || "";
	const headers: Record<string, string> = {};
	if (mlxApiKey) {
		headers["Authorization"] = `Bearer ${mlxApiKey}`;
	}
	try {
		const modelsResp = await fetch(`${MLX_BASE}/v1/models`, {
			signal: AbortSignal.timeout(3000),
			headers,
		});
		if (!modelsResp.ok) {
			return jsonResponse({
				connected: false,
				error: `HTTP ${modelsResp.status}`,
			});
		}
		const modelsData = (await modelsResp.json()) as {
			data?: Array<{
				id: string;
				owned_by?: string;
			}>;
		};
		const models = (modelsData.data ?? []).map((m) => ({
			name: m.id,
			owned_by: m.owned_by,
		}));

		let loaded: string[] = [];
		try {
			const psResp = await fetch(`${MLX_BASE}/api/ps`, {
				signal: AbortSignal.timeout(3000),
				headers,
			});
			if (psResp.ok) {
				const psData = (await psResp.json()) as {
					models?: Array<{ name: string }>;
				};
				loaded = (psData.models ?? []).map((m) => m.name);
			}
		} catch {
			// /api/ps not available — skip
		}

		return jsonResponse({ connected: true, models, loaded, url: MLX_BASE });
	} catch (e) {
		return jsonResponse({
			connected: false,
			error: "Failed to connect to local inference service",
			url: MLX_BASE,
		});
	}
});

// POST /api/kb/build — build knowledge base
routes.set("POST /api/kb/build", async (url) => {
	const cwd = getCwdFromUrl(url);
	try {
		const { buildKB } = await import("../services/knowledgeBase/index.js");
		const result = await buildKB(cwd);
		return jsonResponse({ ok: true, message: result });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/kb/build error: ${e}`);
		return errorResponse("Failed to build knowledge base", 500);
	}
});

// POST /api/kb/query — query knowledge base
routes.set("POST /api/kb/query", async (url, body) => {
	const cwd = getCwdFromUrl(url);
	if (!body || typeof body !== "object") {
		return errorResponse("Request body required", 400);
	}
	const { query, topK } = body as { query?: string; topK?: number };
	if (!query || typeof query !== "string")
		return errorResponse("query must be a non-empty string", 400);
	if (
		topK !== undefined &&
		(typeof topK !== "number" || topK < 1 || topK > 100)
	) {
		return errorResponse("topK must be a number between 1 and 100", 400);
	}
	try {
		const { queryKB } = await import("../services/knowledgeBase/index.js");
		const result = await queryKB(cwd, query, topK ?? 5);
		return jsonResponse({ result });
	} catch (e) {
		logForDebugging(`projectApiServer: /api/kb/query error: ${e}`);
		return errorResponse("Failed to query knowledge base", 500);
	}
});

// GET /api/kb/status — knowledge base status
routes.set("/api/kb/status", async (url) => {
	const cwd = getCwdFromUrl(url);
	try {
		const { getKBStatus } = await import(
			"../services/knowledgeBase/index.js"
		);
		const status = await getKBStatus(cwd);
		return jsonResponse(status);
	} catch (e) {
		logForDebugging(`projectApiServer: /api/kb/status error: ${e}`);
		return errorResponse("Failed to get KB status", 500);
	}
});

// GET /api/templates — list workflow templates
routes.set("/api/templates", async (url) => {
	const cwd = getCwdFromUrl(url);
	try {
		const { listTemplates } = await import(
			"../services/workflowTemplates/index.js"
		);
		const { getBuiltinTemplates } = await import(
			"../services/workflowTemplates/index.js"
		);
		const saved = await listTemplates(cwd);
		const builtinList = getBuiltinTemplates();
		return jsonResponse({
			builtin: builtinList,
			saved,
			total: builtinList.length + saved.length,
		});
	} catch (e) {
		logForDebugging(`projectApiServer: /api/templates error: ${e}`);
		return errorResponse("Failed to list templates", 500);
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
	projectId?: string;
	proc: ReturnType<typeof Bun.spawn> | null;
};

const wsSessions = new Map<ServerWebSocket<undefined>, WsChatState>();

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

async function handleChatStream(
	ws: ServerWebSocket<undefined>,
	data: Record<string, unknown>,
) {
	const sessionId = (data.session_id as string) || crypto.randomUUID();
	const message = data.message as string;
	const cwd = (data.cwd as string) || process.cwd();
	const model = data.model as string | undefined;
	const projectId = data.project_id as string | undefined;

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

	// Load project knowledge-base context if project_id is specified
	let projectContext = "";
	if (projectId) {
		try {
			const decodedName = projectId.replace(/^-/, "").replace(/-/g, "/");
			const ctx = await getProjectContextPortable(decodedName);
			if (ctx.combinedContent) {
				projectContext = ctx.combinedContent;
				logForDebugging(
					`projectApiServer WS: injected project context for ${projectId} (${projectContext.length} chars)`,
				);
			}
		} catch (e) {
			logForDebugging(
				`projectApiServer WS: failed to load project context for ${projectId}: ${e}`,
			);
		}
	}

	const binary = findFusionCodeBinary();
	const commandMode = data.command_mode === true;
	const args = [
		commandMode ? "--command" : "-p",
		message,
		"--output-format",
		"stream-json",
		"--verbose",
	];
	if (model) {
		args.push("--model", model);
	}
	if (projectContext) {
		args.push("--append-system-prompt", projectContext);
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

	wsSessions.set(ws, { sessionId, cwd, projectId, proc });

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

function handleChatCancel(
	ws: ServerWebSocket<undefined>,
	data: Record<string, unknown>,
) {
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

function handleChatCompact(
	ws: ServerWebSocket<undefined>,
	data: Record<string, unknown>,
) {
	const sessionId = (data.session_id as string) || "";
	logForDebugging(
		`projectApiServer WS: compact request for session ${sessionId}`,
	);
	const state = wsSessions.get(ws);
	if (state?.proc) {
		try {
			state.proc.kill();
		} catch {
			/* already dead */
		}
	}
	ws.send(
		JSON.stringify({
			type: "compact_done",
			session_id: sessionId,
			timestamp: Date.now(),
		}),
	);
}

// Resolve the effective auth token for this server instance.
//
// Pre-fix: `if (config.authToken)` was fail-open — an empty authToken
// (the default, and what start.sh passes when FUSION_API_KEY is unset)
// silently disabled auth, exposing the project API unauthenticated. A
// process with no explicit token must NOT be reachable without auth.
//
// Resolution order:
//   1. explicit --auth / FUSION_API_KEY -> use verbatim
//   2. FUSION_CODE_NO_AUTH=1 / --no-auth -> explicitly disabled (dev only,
//      loud warning). Only opt-out path.
//   3. otherwise -> generate a per-instance random token and persist it to
//      ~/.fusion-code/server.token (mode 0600) so a trusted local client
//      (Fusion Studio) can discover it. Server stays fail-closed.
export function resolveEffectiveAuthToken(config: ServerConfig): {
	token: string | null;
	tokenFile?: string;
	disabled: boolean;
} {
	if (config.authDisabled || isEnvTruthy(process.env.FUSION_CODE_NO_AUTH)) {
		logForDebugging(
			"projectApiServer: auth DISABLED via FUSION_CODE_NO_AUTH/--no-auth (dev only). API is unauthenticated.",
		);
		return { token: null, disabled: true };
	}
	if (config.authToken && config.authToken.trim() !== "") {
		return { token: config.authToken, disabled: false };
	}
	// No explicit token and not opted out -> generate one and persist for
	// client discovery. Fail-closed: an unknown client cannot connect.
	const generated = randomBytes(32).toString("hex");
	const configDir =
		process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
	const tokenFile = join(configDir, "server.token");
	// P1-15: 同步阻塞写 — 此前 fire-and-forget async 写让 Bun.serve 先接连接,
	// 本地客户端 (Fusion Studio) 立即轮询 server.token 竞态错过写 → 静默 auth 锁定。
	// 此函数在 startProjectApiServer 启动时调一次 (非热路径), 同步写保证文件在
	// serve 前存在。写失败 = fail-closed (throw, 启动失败 surfacing), 不留 in-memory
	// token 无客户端可获的静默锁定。
	try {
		mkdirSync(configDir, { recursive: true });
		writeFileSync(tokenFile, generated, { mode: 0o600 });
		chmodSync(tokenFile, 0o600);
		logForDebugging(
			`projectApiServer: generated per-instance auth token, written to ${tokenFile} (mode 0600)`,
		);
	} catch (e) {
		logForDebugging(
			`projectApiServer: failed to persist generated token to ${tokenFile}: ${e}. ` +
				`Fail-closed: refusing to start with in-memory-only token (no local client could discover it). Pass --auth explicitly.`,
		);
		throw new Error(
			`failed to persist per-instance auth token to ${tokenFile}: ${e}. ` +
				`Auth fail-closed — pass --auth=<token> explicitly or fix config dir permissions.`,
		);
	}
	return { token: generated, tokenFile, disabled: false };
}

// Store config globally so WS handlers can access authToken
let config_global: ServerConfig = {
	port: 11441,
	host: "127.0.0.1",
	authToken: "",
};

// P0-2: rate-limit key must NOT trust client-supplied X-Forwarded-For by
// default. Without a trusted reverse proxy in front, a remote attacker sets
// that header to a fresh value per request and bypasses the per-IP limit
// entirely (and pins out a victim). Use the raw socket peer address from
// Bun's server.requestIP; only honor forwarded headers when an operator has
// explicitly set FUSION_CODE_TRUSTED_PROXY=1 (they own the proxy hop that
// overwrites the header before it reaches us).
function resolveClientIp(
	req: Request,
	server: import("bun").Server<unknown>,
): string {
	if (isEnvTruthy(process.env.FUSION_CODE_TRUSTED_PROXY)) {
		const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
		if (fwd) return fwd;
		const real = req.headers.get("x-real-ip");
		if (real) return real;
	}
	try {
		const ip = server.requestIP(req);
		if (ip) {
			return typeof ip === "string" ? ip : (ip as { address: string }).address;
		}
	} catch {
		// requestIP can throw on some platforms; fall back to "local"
	}
	return "local";
}

export function startProjectApiServer(config: ServerConfig): {
	port: number;
	stop: () => void;
} {
	config_global = config;
	// Resolve effective auth token (fail-closed). Empty authToken no longer
	// disables auth; a per-instance token is generated instead. See
	// resolveEffectiveAuthToken for the resolution order.
	const effective = resolveEffectiveAuthToken(config);
	config_global.effectiveAuthToken = effective.token ?? undefined;
	config_global.authDisabled = effective.disabled;
	config_global.tokenFile = effective.tokenFile;

	const server = Bun.serve({
		port: config.port,
		hostname: config.host || "127.0.0.1",
		websocket: {
			open(ws) {
				logForDebugging("projectApiServer WS: client connected");
				const pingInterval = setInterval(() => {
					try {
						ws.ping();
					} catch {
						clearInterval(pingInterval);
					}
				}, 30000);
				(ws as unknown as Record<string, unknown>).__pingInterval =
					pingInterval;
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
						case "chat.compact":
							handleChatCompact(ws, data);
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
				const pingInterval = (ws as unknown as Record<string, unknown>)
					.__pingInterval as ReturnType<typeof setInterval> | undefined;
				if (pingInterval) clearInterval(pingInterval);
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
		async fetch(req, server) {
			const url = new URL(req.url);
			const method = req.method;

			// WebSocket upgrade for /ws/chat
			if (
				url.pathname === "/ws/chat" &&
				req.headers.get("upgrade") === "websocket"
			) {
				logForDebugging("projectApiServer: WS upgrade request for /ws/chat");
				// Fail-closed: require a matching token unless auth is explicitly
				// disabled (--no-auth / FUSION_CODE_NO_AUTH). An empty authToken
				// no longer skips auth (issue #132).
				const wsEffective =
					config_global.effectiveAuthToken ?? config.authToken;
				if (!config_global.authDisabled && wsEffective) {
					const wsAuth = req.headers.get("Authorization");
					const wsToken = url.searchParams.get("token");
					if (
						wsAuth !== `Bearer ${wsEffective}` &&
						wsToken !== wsEffective
					) {
						return errorResponse("Unauthorized", 401);
					}
				}
				const wsClientIp = resolveClientIp(req, server);
				const { checkOperationRateLimit: wsRateLimit } = await import(
					"../services/audit/index.js"
				);
				const wsRateResult = wsRateLimit(`api:${wsClientIp}`, 120);
				if (!wsRateResult.allowed) {
					return new Response(
						JSON.stringify({ error: "Rate limit exceeded" }),
						{ status: 429, headers: { "Content-Type": "application/json" } },
					);
				}
				const upgraded = server.upgrade(req);
				if (!upgraded) {
					return errorResponse("WebSocket upgrade failed", 500);
				}
				return upgraded as unknown as Response;
			}

			// API rate limiting — 120 requests per minute per IP
			// P0-2: key from the raw socket peer, not client-supplied
			// X-Forwarded-For (spoofable unless a trusted proxy is in front and
			// FUSION_CODE_TRUSTED_PROXY=1). See resolveClientIp.
			const clientIp = resolveClientIp(req, server);
			const { checkOperationRateLimit } = await import(
				"../services/audit/index.js"
			);
			const apiRateLimit = checkOperationRateLimit(`api:${clientIp}`, 120);
			if (!apiRateLimit.allowed) {
				return new Response(
					JSON.stringify({
						error: "Rate limit exceeded",
						detail: `${apiRateLimit.currentCount}/${apiRateLimit.maxOps} requests per minute`,
					}),
					{
						status: 429,
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			// CORS headers for Fusion Studio.
			// P0-1: never allow cross-origin from any origin when auth is disabled
			// — `Access-Control-Allow-Origin: *` on an unauthenticated RCE surface
			// lets any web page drive the server. When auth is disabled, emit NO
			// ACAO header (browsers block cross-origin fetches, which is the safe
			// default for the dev-only --no-auth path). When auth is enabled,
			// reflect the request Origin so Fusion Studio (same machine, known
			// origin) still works, and require the bearer token on every call.
			const corsOrigin = config_global.authDisabled
				? null
				: (req.headers.get("origin") ?? "*");
			if (method === "OPTIONS") {
				const preflightHeaders: Record<string, string> = {
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
				};
				if (corsOrigin) {
					preflightHeaders["Access-Control-Allow-Origin"] = corsOrigin;
					if (corsOrigin !== "*") {
						preflightHeaders["Vary"] = "Origin";
					}
				}
				return new Response(null, {
					status: 204,
					headers: preflightHeaders,
				});
			}

			// Auth check — fail-closed (issue #132). An empty authToken no
			// longer disables auth; a per-instance token is enforced unless
			// auth is explicitly disabled via --no-auth / FUSION_CODE_NO_AUTH.
			const httpEffective =
				config_global.effectiveAuthToken ?? config.authToken;
			if (!config_global.authDisabled && httpEffective) {
				const auth = req.headers.get("Authorization");
				if (auth !== `Bearer ${httpEffective}`) {
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
				// P0-1: add CORS headers to all responses — but only when auth is
				// enabled (see the OPTIONS preflight block above for rationale).
				// Reflecting Origin instead of "*" avoids granting every web page
				// access to the authenticated API.
				if (corsOrigin) {
					response.headers.set("Access-Control-Allow-Origin", corsOrigin);
					if (corsOrigin !== "*") {
						response.headers.set("Vary", "Origin");
					}
				}
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
