// fusion-executor Layer B client — UDS NDJSON-RPC.
// Wire = newline-delimited JSON-RPC 2.0 (NOT LSP Content-Length framing).
// fe-ipc writes each frame as `serde_json::to_string(resp) + "\n"` (lib.rs:701).
// So we use a raw net.Socket duplex + line buffer, NOT vscode-jsonrpc
// StreamMessageReader (that expects Content-Length headers → would hang).
// Mirror LSPClient.ts lifecycle: spawn-gate, isStopping, onCrash, stop().

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { logForDebugging } from "../../utils/debug.js";
import { errorMessage } from "../../utils/errors.js";
import { logError } from "../../utils/log.js";
import { subprocessEnv } from "../../utils/subprocessEnv.js";
import type {
	ExecutionRequest,
	ExecutionResult,
	ExecutorStreamChunk,
	RollbackResult,
	SnapshotResult,
} from "./types.js";

export type ExecutorHealth = {
	ok: boolean;
	version?: string;
	[k: string]: unknown;
};

export type ExecutorClient = {
	readonly isRunning: boolean;
	start: () => Promise<void>;
	health: () => Promise<ExecutorHealth>;
	execute: (req: ExecutionRequest) => Promise<ExecutionResult>;
	executeStream: (
		req: ExecutionRequest,
		onChunk: (chunk: ExecutorStreamChunk) => void,
		signal?: AbortSignal,
	) => Promise<ExecutionResult>;
	snapshotCreate: (cwd: string) => Promise<SnapshotResult>;
	rollback: (snapshotId: string, cwd: string) => Promise<RollbackResult>;
	stop: () => Promise<void>;
};

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	stream?: {
		onChunk: (chunk: ExecutorStreamChunk) => void;
		done?: ExecutionResult;
	};
};

let requestCounter = 0;

// P2-19: 随机 socket 路径置于 0700 私有目录, 非可预测的 tmpdir/fusion-executor-<pid>.sock。
// 原路径可预测 → 任何同用户进程可 connect() socket 驱动 executor.execute 跑任意 bash,
// 绕过 CLI 工具权限+审批。随机名 + 0700 目录让 socket 路径不猜得中, 仅本进程+子进程知。
// auth 握手 token 需 fusion-executor 服务端校验 (跨仓), 此处仅客户端侧硬化路径。
function executorSocketDir(): string {
	const base =
		process.env.FUSION_CODE_CONFIG_DIR ||
		`${process.env.HOME || ""}/.fusion-code`;
	return join(base, "executor");
}

function defaultSocketPath(): string {
	const dir = executorSocketDir();
	try {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	} catch (e) {
		logForDebugging(
			`executor client: failed to create 0700 socket dir ${dir}: ${errorMessage(e)}`,
		);
	}
	const rand = randomBytes(8).toString("hex");
	return join(dir, `executor-${process.pid}-${rand}.sock`);
}

// Resolve socket path: explicit arg > env FUSION_EXECUTOR_SOCK > random 0700-dir default.
function resolveSocketPath(override?: string): string {
	if (override) return override;
	if (process.env.FUSION_EXECUTOR_SOCK) return process.env.FUSION_EXECUTOR_SOCK;
	return defaultSocketPath();
}

export function createExecutorClient(
	onCrash?: (error: Error) => void,
): ExecutorClient {
	let proc: ChildProcess | undefined;
	let socket: Socket | undefined;
	let socketPath = "";
	let isStopping = false;
	let isRunning = false;
	let startFailed = false;
	let startError: Error | undefined;
	// NDJSON line buffer — frames split on \n, partial frames held across data events.
	let lineBuffer = "";
	const pending = new Map<number, PendingRequest>();

	function checkStartFailed(): void {
		if (startFailed) {
			throw startError || new Error("fusion-executor failed to start");
		}
	}

	function failAllPending(error: Error): void {
		for (const [, req] of pending) {
			req.reject(error);
		}
		pending.clear();
	}

	function handleFrame(frame: unknown): void {
		const msg = frame as {
			jsonrpc?: string;
			id?: number;
			result?: unknown;
			error?: { code: number; message: string };
		};
		if (msg.id === undefined || msg.id === null) return;
		const req = pending.get(msg.id);
		if (!req) return;
		if (msg.error) {
			const err = new Error(
				`executor error ${msg.error.code}: ${msg.error.message}`,
			);
			pending.delete(msg.id);
			req.reject(err);
			return;
		}
		const result = msg.result as
			| ExecutorStreamChunk
			| ExecutionResult
			| ExecutorHealth;
		// execute_stream: multiple result frames share one id (chunk...chunk...done).
		if (req.stream) {
			const chunk = result as ExecutorStreamChunk;
			if (chunk.type === "chunk") {
				req.stream.onChunk(chunk);
			} else if (chunk.type === "done") {
				req.stream.done = chunk.result;
				// done is terminal — resolve and clear.
				pending.delete(msg.id);
				req.resolve(chunk.result);
			}
			return;
		}
		// single request/response (health, execute).
		pending.delete(msg.id);
		req.resolve(result);
	}

	function processBuffer(): void {
		let idx = lineBuffer.indexOf("\n");
		while (idx !== -1) {
			const line = lineBuffer.slice(0, idx).trim();
			lineBuffer = lineBuffer.slice(idx + 1);
			if (!line) {
				idx = lineBuffer.indexOf("\n");
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (e) {
				logForDebugging(
					`executor client: skipping unparseable frame: ${errorMessage(e)}`,
				);
				idx = lineBuffer.indexOf("\n");
				continue;
			}
			handleFrame(parsed);
			idx = lineBuffer.indexOf("\n");
		}
	}

	function sendRequest(
		method: string,
		params: unknown,
		stream?: PendingRequest["stream"],
	): { id: number; promise: Promise<unknown> } {
		checkStartFailed();
		if (!socket || socket.destroyed) {
			throw new Error("executor client not connected");
		}
		const id = ++requestCounter;
		const frame = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
		const promise = new Promise<unknown>((resolve, reject) => {
			pending.set(id, { resolve, reject, stream });
		});
		socket.write(frame, (err) => {
			if (err) {
				const req = pending.get(id);
				if (req) {
					pending.delete(id);
					req.reject(new Error(`executor write failed: ${err.message}`));
				}
			}
		});
		return { id, promise };
	}

	return {
		get isRunning(): boolean {
			return isRunning;
		},

		async start(): Promise<void> {
			socketPath = resolveSocketPath();
			try {
				// Spawn fusion-executor --serve --sock <path> (persistent UDS server).
				proc = spawn("fusion-executor", ["--serve", "--sock", socketPath], {
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...subprocessEnv(), FUSION_EXECUTOR_SOCK: socketPath },
					windowsHide: true,
				});

				// spawn-gate (mirror LSPClient:115-131): await spawn/error before
				// connecting — prevents ENOENT unhandled rejections when binary missing.
				const spawnedProc = proc;
				await new Promise<void>((resolve, reject) => {
					const onSpawn = (): void => {
						cleanup();
						resolve();
					};
					const onError = (error: Error): void => {
						cleanup();
						reject(error);
					};
					const cleanup = (): void => {
						spawnedProc.removeListener("spawn", onSpawn);
						spawnedProc.removeListener("error", onError);
					};
					spawnedProc.once("spawn", onSpawn);
					spawnedProc.once("error", onError);
				});

				if (proc.stderr) {
					proc.stderr.on("data", (data: Buffer) => {
						const output = data.toString().trim();
						if (output) logForDebugging(`[executor] ${output}`);
					});
				}
				proc.on("error", (error) => {
					if (!isStopping) {
						startFailed = true;
						startError = error;
						logError(new Error(`fusion-executor failed: ${error.message}`));
					}
				});
				proc.on("exit", (code, _signal) => {
					if (!isStopping) {
						isRunning = false;
						const crashError = new Error(
							`fusion-executor exited with code ${code}`,
						);
						logError(crashError);
						failAllPending(crashError);
						onCrash?.(crashError);
					}
				});

				// Connect UDS. Retry briefly — executor binds async after spawn.
				socket = await connectWithRetry(socketPath);
				socket.on("data", (chunk: Buffer) => {
					lineBuffer += chunk.toString("utf8");
					processBuffer();
				});
				socket.on("error", (err) => {
					if (!isStopping) {
						logForDebugging(`executor socket error: ${err.message}`);
						failAllPending(new Error(`executor socket error: ${err.message}`));
					}
				});
				socket.on("close", () => {
					if (!isStopping) {
						isRunning = false;
						failAllPending(new Error("executor socket closed unexpectedly"));
					}
				});

				isRunning = true;
				logForDebugging(`executor client started (sock=${socketPath})`);
			} catch (error) {
				const err = error as Error;
				logError(new Error(`fusion-executor start failed: ${err.message}`));
				startFailed = true;
				startError = err;
				throw error;
			}
		},

		async health(): Promise<ExecutorHealth> {
			const { promise } = sendRequest("executor.health", {});
			return promise as Promise<ExecutorHealth>;
		},

		async execute(req: ExecutionRequest): Promise<ExecutionResult> {
			const { promise } = sendRequest("executor.execute", req);
			return promise as Promise<ExecutionResult>;
		},

		async executeStream(
			req: ExecutionRequest,
			onChunk: (chunk: ExecutorStreamChunk) => void,
			signal?: AbortSignal,
		): Promise<ExecutionResult> {
			const stream = { onChunk };
			const { id, promise } = sendRequest(
				"executor.execute_stream",
				req,
				stream,
			);
			if (signal) {
				if (signal.aborted) {
					// P1-7: 已中止 → 仅 reject 本请求, 不动共享 socket。
					const pendingReq = pending.get(id);
					if (pendingReq) {
						pending.delete(id);
						pendingReq.reject(
							new Error("executor executeStream aborted before start"),
						);
					}
					throw new Error("executor executeStream aborted before start");
				}
				// P1-7: 此前 abort 调 failAllPending (毁全部在途) + socket.destroy
				// (毁共享 UDS, reject 所有并发 bash 调用)。abort 单流不应毁全局。
				// 改: 仅 reject 本 id + 发 executor.cancel RPC 让 server 杀 child;
				// listener 在 promise settle 时移除 (不泄漏每次调用一个 listener)。
				const onAbort = () => {
					const pendingReq = pending.get(id);
					if (pendingReq) {
						pending.delete(id);
						pendingReq.reject(new Error("executor executeStream aborted"));
					}
					// best-effort cancel RPC (server 杀 child); 不等回应, 失败已 fail-soft。
					try {
						sendRequest("executor.cancel", { id });
					} catch {
						// socket 已断则 cancel 无法发, 本请求已 reject, 无副作用。
					}
				};
				signal.addEventListener("abort", onAbort, { once: true });
				// settle 后移除 listener (resolve/reject 都清理, 避免监听器泄漏)。
				promise.finally(() => signal.removeEventListener("abort", onAbort));
			}
			return promise as Promise<ExecutionResult>;
		},

		async snapshotCreate(cwd: string): Promise<SnapshotResult> {
			// Phase 3b turn-boundary: caller-owned git snapshot. Non-repo cwd
			// returns snapshot_id="" upstream (safe no-op). Caller gates on env.
			const { promise } = sendRequest("executor.snapshot_create", { cwd });
			return promise as Promise<SnapshotResult>;
		},

		async rollback(snapshotId: string, cwd: string): Promise<RollbackResult> {
			// Empty snapshot_id = non-repo no-op upstream; skip the RPC entirely
			// so an accidental call on a non-repo cwd doesn't round-trip.
			if (!snapshotId) {
				return { ok: false };
			}
			const { promise } = sendRequest("executor.rollback", {
				snapshot_id: snapshotId,
				cwd,
			});
			return promise as Promise<RollbackResult>;
		},

		async stop(): Promise<void> {
			let stopError: Error | undefined;
			isStopping = true;
			try {
				if (socket && !socket.destroyed) {
					// Best-effort graceful shutdown notification.
					try {
						socket.write(
							`${JSON.stringify({ jsonrpc: "2.0", method: "executor.shutdown", params: {} })}\n`,
						);
					} catch {
						// socket may already be closing
					}
				}
			} catch (error) {
				stopError = error as Error;
			} finally {
				if (socket) {
					try {
						socket.removeAllListeners();
						socket.destroy();
					} catch {
						/* ignore */
					}
					socket = undefined;
				}
				if (proc) {
					try {
						proc.removeAllListeners();
						proc.kill();
					} catch {
						/* may be dead */
					}
					proc = undefined;
				}
				failAllPending(new Error("executor client stopped"));
				isRunning = false;
				isStopping = false;
				// Double-unlink socket — executor owns cleanup but guard orphaned files.
				if (socketPath && existsSync(socketPath)) {
					try {
						unlinkSync(socketPath);
					} catch {
						/* ignore */
					}
				}
				logForDebugging("executor client stopped");
			}
			if (stopError) throw stopError;
		},
	};
}

// Connect to UDS socket once — resolves on connect, rejects on error/timeout.
function connectOnce(path: string): Promise<Socket> {
	return new Promise<Socket>((resolve, reject) => {
		const sock = createConnection({ path });
		const cleanup = (): void => {
			sock.removeAllListeners();
		};
		sock.once("connect", () => {
			cleanup();
			sock.setTimeout(0);
			sock.setEncoding(null);
			resolve(sock);
		});
		sock.once("error", (err) => {
			cleanup();
			sock.destroy();
			reject(err);
		});
		sock.setTimeout(5000);
		sock.once("timeout", () => {
			cleanup();
			sock.destroy();
			reject(new Error("executor UDS connect timeout"));
		});
	});
}

// Connect to UDS with retry — executor binds shortly after spawn. Stale socket
// file from a prior crash → unlink on ECONNREFUSED so next attempt hits fresh bind.
async function connectWithRetry(
	path: string,
	maxAttempts = 20,
	delayMs = 50,
): Promise<Socket> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await connectOnce(path);
		} catch (e) {
			const err = e as Error & { code?: string };
			if (err.code === "ECONNREFUSED" && existsSync(path)) {
				try {
					unlinkSync(path);
				} catch {
					/* ignore */
				}
			}
			if (attempt === maxAttempts - 1) {
				throw new Error(
					`executor UDS connect failed after ${maxAttempts} attempts: ${err.message}`,
				);
			}
			await new Promise<void>((r) => setTimeout(r, delayMs));
		}
	}
	throw new Error("executor UDS connect failed");
}
