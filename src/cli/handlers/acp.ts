import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

// Evolution plan P3.1 — ACP (Agent Client Protocol) server, C8. Exposes the
// agent over JSON-RPC 2.0, newline-delimited on stdio, so ACP editors (Zed
// and any ACP client) connect without a bespoke extension. Translation
// layer, not a rewrite: each session/prompt spawns the kernel headless
// (`-p --output-format stream-json --verbose`) and translates the event
// stream into session/update notifications (agent_message_chunk, tool_call,
// tool_call_update). v1 protocol per agentclientprotocol.com.
//
// Kernel invocation reuses the FUSION_CODE_TASK_FUSION_BIN test seam.

type AcpContentBlock = { type: string; text?: string };

type JsonRpcMessage = {
	jsonrpc: "2.0";
	id?: number | string;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

type AcpSession = {
	id: string;
	cwd: string;
	cancelled: boolean;
	busy: boolean;
	child: Bun.Subprocess<"ignore", "pipe", "pipe"> | null;
};

const PROTOCOL_VERSION = 1;

function logAcp(message: string): void {
	console.error(`[acp] ${message}`);
}

// Kernel binary resolution — same seam as task.ts (FUSION_CODE_TASK_FUSION_BIN
// replaces the invocation wholesale so tests run without a model).
function acpKernelArgv(prompt: string, cwd: string): { cmd: string[]; cwd: string } {
	const stub = process.env.FUSION_CODE_TASK_FUSION_BIN;
	if (stub) return { cmd: [stub, prompt], cwd };
	return {
		cmd: [
			process.execPath,
			"-p",
			prompt,
			"--output-format",
			"stream-json",
			"--verbose",
		],
		cwd,
	};
}

// Coarse ACP ToolKind from the kernel tool name (UI hint only).
const TOOL_KINDS: Record<string, string> = {
	Read: "read",
	Glob: "search",
	Grep: "search",
	WebSearch: "search",
	WebFetch: "fetch",
	Bash: "execute",
	ExecutorBash: "execute",
	Write: "edit",
	Edit: "edit",
	NotebookEdit: "edit",
	MultiEdit: "edit",
	TodoWrite: "think",
	Workflow: "think",
};

function toolKind(toolName: string): string {
	return TOOL_KINDS[toolName] ?? "other";
}

type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

function stopReasonFromResult(result: Record<string, unknown>): StopReason {
	if (result.is_error === true) return "refusal";
	const subtype = typeof result.subtype === "string" ? result.subtype : "";
	if (subtype.includes("max_turns")) return "max_turn_requests";
	return "end_turn";
}

export type AcpAgent = {
	handleLine: (line: string) => Promise<void>;
	sessions: Map<string, AcpSession>;
	done: Promise<void>;
};

// Factory: input = async iterable of NDJSON lines (testable seam), output =
// writer callback for every outgoing JSON-RPC message (one per line).
export function createAcpAgent(
	input: AsyncIterable<string>,
	write: (message: JsonRpcMessage) => void,
): AcpAgent {
	const sessions = new Map<string, AcpSession>();
	let initialized = false;

	function send(id: number | string, result: unknown): void {
		write({ jsonrpc: "2.0", id, result });
	}

	function sendError(id: number | string, code: number, message: string): void {
		write({ jsonrpc: "2.0", id, error: { code, message } });
	}

	function notify(sessionId: string, update: Record<string, unknown>): void {
		write({
			jsonrpc: "2.0",
			method: "session/update",
			params: { sessionId, update },
		});
	}

	async function runPromptTurn(session: AcpSession, promptText: string, requestId: number | string): Promise<void> {
		const { cmd, cwd } = acpKernelArgv(promptText, session.cwd);
		const child = Bun.spawn(cmd, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, FUSION_CODE_TASK_FUSION_BIN: "" },
		});
		session.child = child;
		session.cancelled = false;
		const stdout = await new Response(child.stdout).text();
		const exitCode = await child.exited;
		session.child = null;

		// Kernel event stream → ACP session/update notifications. The result
		// line decides the session/prompt response; stream_event text deltas
		// stream out live, assistant tool_use blocks become tool_call updates,
		// user tool_result blocks close them.
		const completedToolCalls = new Set<string>();
		let stopReason: StopReason = exitCode !== 0 ? "refusal" : "end_turn";
		for (const line of stdout.split("\n")) {
			if (!line.trim().startsWith("{")) continue;
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			if (event.type === "stream_event") {
				const inner = event.event as Record<string, unknown> | undefined;
				if (inner?.type === "content_block_delta") {
					const delta = inner.delta as Record<string, unknown> | undefined;
					if (delta?.type === "text_delta" && typeof delta.text === "string") {
						notify(session.id, {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: delta.text },
						});
					}
				}
				continue;
			}
			if (event.type === "assistant") {
				const message = event.message as Record<string, unknown> | undefined;
				const blocks = (message?.content ?? []) as Array<Record<string, unknown>>;
				for (const block of blocks) {
					if (block.type === "tool_use" && typeof block.id === "string") {
						completedToolCalls.delete(block.id);
						notify(session.id, {
							sessionUpdate: "tool_call",
							toolCallId: block.id,
							title: typeof block.name === "string" ? block.name : "tool",
							kind: toolKind(typeof block.name === "string" ? block.name : ""),
							status: "in_progress",
						});
					}
				}
				continue;
			}
			if (event.type === "user") {
				const message = event.message as Record<string, unknown> | undefined;
				const blocks = (message?.content ?? []) as Array<Record<string, unknown>>;
				for (const block of blocks) {
					if (
						block.type === "tool_result" &&
						typeof block.tool_use_id === "string" &&
						!completedToolCalls.has(block.tool_use_id)
					) {
						completedToolCalls.add(block.tool_use_id);
						notify(session.id, {
							sessionUpdate: "tool_call_update",
							toolCallId: block.tool_use_id,
							status: block.is_error === true ? "failed" : "completed",
						});
					}
				}
				continue;
			}
			if (event.type === "result") {
				stopReason = session.cancelled ? "cancelled" : stopReasonFromResult(event);
			}
		}
		if (session.cancelled) stopReason = "cancelled";
		send(requestId, { stopReason });
	}

	async function handleRequest(msg: JsonRpcMessage): Promise<void> {
		const id = msg.id!;
		const params = (msg.params ?? {}) as Record<string, unknown>;
		switch (msg.method) {
			case "initialize": {
				initialized = true;
				send(id, {
					protocolVersion: PROTOCOL_VERSION,
					agentCapabilities: {
						loadSession: false,
						promptCapabilities: {
							image: false,
							audio: false,
							embeddedContext: false,
						},
					},
					// MACRO.VERSION is a build-time macro — undefined when the
					// handler runs unbundled (bun test), fall back gracefully.
					agentInfo: {
						name: "fusion-code",
						version:
							typeof MACRO !== "undefined" ? MACRO.VERSION : "dev",
					},
					authMethods: [],
				});
				return;
			}
			case "session/new": {
				if (!initialized) {
					sendError(id, -32002, "not initialized — call initialize first");
					return;
				}
				const session: AcpSession = {
					id: `sess_${randomUUID().slice(0, 12)}`,
					cwd: typeof params.cwd === "string" ? params.cwd : process.cwd(),
					cancelled: false,
					busy: false,
					child: null,
				};
				sessions.set(session.id, session);
				send(id, { sessionId: session.id });
				return;
			}
			case "session/prompt": {
				if (!initialized) {
					sendError(id, -32002, "not initialized — call initialize first");
					return;
				}
				const session = sessions.get(String(params.sessionId ?? ""));
				if (!session) {
					sendError(id, -32602, `unknown sessionId: ${String(params.sessionId)}`);
					return;
				}
				if (session.busy) {
					sendError(id, -32001, "session already processing a prompt");
					return;
				}
				const blocks = (params.prompt ?? []) as AcpContentBlock[];
				const promptText = blocks
					.map((b) => (b.type === "text" ? (b.text ?? "") : ""))
					.filter(Boolean)
					.join("\n");
				if (!promptText) {
					sendError(id, -32602, "prompt must contain at least one text block");
					return;
				}
				session.busy = true;
				try {
					await runPromptTurn(session, promptText, id);
				} catch (err) {
					logAcp(`prompt turn failed: ${String(err)}`);
					sendError(id, -32000, `prompt turn failed: ${String(err).slice(0, 200)}`);
				} finally {
					session.busy = false;
				}
				return;
			}
			default:
				sendError(id, -32601, `method not supported: ${String(msg.method)}`);
		}
	}

	function handleNotification(msg: JsonRpcMessage): void {
		const params = (msg.params ?? {}) as Record<string, unknown>;
		if (msg.method === "session/cancel") {
			const session = sessions.get(String(params.sessionId ?? ""));
			if (session) {
				session.cancelled = true;
				session.child?.kill();
			}
			return;
		}
		// Unknown notifications are ignored (forward compat).
	}

	async function handleLine(line: string): Promise<void> {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) return;
		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(trimmed) as JsonRpcMessage;
		} catch {
			logAcp(`dropping non-JSON line`);
			return;
		}
		if (msg.method && msg.id !== undefined && msg.id !== null) {
			await handleRequest(msg);
		} else if (msg.method) {
			handleNotification(msg);
		}
		// Responses to agent→client requests: none — this agent issues no
		// client-bound requests (fs/terminal capabilities not used).
	}

	// Drive the input loop; `done` resolves when stdin closes (ACP lifecycle:
	// the client closes stdin to terminate the agent).
	let resolveDone: (() => void) | null = null;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	void (async () => {
		for await (const line of input) {
			await handleLine(line);
		}
		resolveDone?.();
	})();

	return { handleLine, sessions, done };
}

// stdio entrypoint: stdin lines in, NDJSON responses out. stdout carries ONLY
// ACP messages (spec MUST); kernel child stdout is piped, never inherited.
export async function acpMain(): Promise<void> {
	logAcp("agent client protocol server starting (v1, stdio)");
	const agent = createAcpAgent(
		// Incremental line reader — must stream, not pre-read: clients wait on
		// responses while still writing requests.
		(async function* () {
			const rl = createInterface({ input: process.stdin });
			try {
				for await (const line of rl) yield line;
			} finally {
				rl.close();
			}
		})(),
		(message) => process.stdout.write(`${JSON.stringify(message)}\n`),
	);
	await agent.done;
	logAcp("stdin closed — shutting down");
}
