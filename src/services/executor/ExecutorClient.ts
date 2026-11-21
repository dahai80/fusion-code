// fusion-executor Layer B client — UDS NDJSON-RPC.
// Wire = newline-delimited JSON-RPC 2.0 (NOT LSP Content-Length framing).
// fe-ipc writes each frame as `serde_json::to_string(resp) + "\n"` (lib.rs:701).
// So we use a raw net.Socket duplex + line buffer, NOT vscode-jsonrpc
// StreamMessageReader (that expects Content-Length headers → would hang).
// Mirror LSPClient.ts lifecycle: spawn-gate, isStopping, onCrash, stop().

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { logForDebugging } from "../../utils/debug.js";
import { errorMessage } from "../../utils/errors.js";
import { logError } from "../../utils/log.js";
import { subprocessEnv } from "../../utils/subprocessEnv.js";
import type {
	EditResult,
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
	writeFile: (params: {
		path: string;
		content: string;
		cwd?: string;
	}) => Promise<EditResult>;
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

// P3-2: requestCounter moved into the createExecutorClient closure (see below).
// Previously module-level shared across clients → two coexisting clients collided on IDs → rejected the wrong pending entry.

// P2-19: random socket path placed in a 0700 private directory, not the predictable tmpdir/fusion-executor-<pid>.sock.
// The old path was predictable → any same-user process could connect() to the socket and drive executor.execute to run arbitrary bash,
// bypassing CLI tool permissions+approval. Random name + 0700 directory make the socket path unguessable, known only to this process+children.
// An auth handshake token requires server-side validation in fusion-executor (cross-repo); this hardens the client side only.
function executorSocketDir(): string {
	const base =
		process.env.FUSION_CODE_CONFIG_DIR ||
		`${process.env.HOME || ""}/.fusion-code`;
	return join(base, "executor");
}

function defaultSocketPath(): string {
	const dir = executorSocketDir();
	try {
		// P2-5 (audit 0901): reject symlinks — an attacker pre-creates dir as a symlink pointing to a directory they control
		// → executor builds the socket in the hijacked directory → attacker connect()s and runs arbitrary bash. lstat does not
		// follow symlinks; if it is a symlink, throw and refuse this path (falling through to a failed socket bind = fail-visible,
		// better than silently using the hijacked directory). Only create the 0700 private directory when it does not exist.
		if (existsSync(dir)) {
			if (lstatSync(dir).isSymbolicLink()) {
				throw new Error(
					`executor socket dir ${dir} is a symlink (possible hijack) — refusing`,
				);
			}
		} else {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	} catch (e) {
		logForDebugging(
			`executor client: socket dir ${dir} unusable: ${errorMessage(e)}`,
			{ level: "warn" },
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

// P2-4 (audit 0901): grace period for stop() to wait for child process exit after SIGTERM, SIGKILL
// tree-kill as backstop on timeout. 2s lets the fusion-executor server flush gracefully without blocking CLI shutdown too long.
const P2_4_STOP_GRACE_MS = Number.isFinite(
	parseInt(process.env.FUSION_CODE_EXECUTOR_STOP_GRACE_MS ?? "", 10),
)
	? parseInt(process.env.FUSION_CODE_EXECUTOR_STOP_GRACE_MS ?? "", 10)
	: 2000;

// P2-4 (audit 0901): wait for child process exit, resolve(false) on timeout (caller sends SIGKILL based on it).
// Does not reject — stop() uses this to decide whether to escalate the kill; rejecting would pollute the finally flow.
function waitForProcessExit(
	child: ChildProcess,
	timeoutMs: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		if (child.killed || child.exitCode !== null) {
			resolve(true);
			return;
		}
		const onExit = (): void => {
			clearTimeout(timer);
			resolve(true);
		};
		const timer = setTimeout(() => {
			child.removeListener("exit", onExit);
			resolve(false);
		}, timeoutMs);
		child.once("exit", onExit);
	});
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
	// P3-2 (audit 0901): offset cursor replaces per-line slice string rebuilds. Old lineBuffer = lineBuffer.slice(idx+1)
	// copied the remaining buffer O(n) per line → N lines O(n²) (CPU spikes on long build logs). Switched to a lineOffset cursor:
	// line extraction uses slice(offset, idx) leaving the original string untouched while offset advances; only when the unconsumed
	// leftover prefix exceeds the threshold is it compacted once (amortized O(n)), preventing unbounded cursor growth.
	let lineBuffer = "";
	let lineOffset = 0;
	const LINE_BUFFER_COMPACT_THRESHOLD = 65536;
	const pending = new Map<number, PendingRequest>();
	// P3-2: per-client counter (was module-level → cross-client ID collision).
	let requestCounter = 0;

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
		// P3-2: scan with the lineOffset cursor instead of rebuilding lineBuffer via slice per line. idx is the absolute position;
		// line content = slice(lineOffset, idx); after consumption lineOffset = idx + 1.
		let idx = lineBuffer.indexOf("\n", lineOffset);
		while (idx !== -1) {
			const line = lineBuffer.slice(lineOffset, idx).trim();
			lineOffset = idx + 1;
			if (!line) {
				idx = lineBuffer.indexOf("\n", lineOffset);
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (e) {
				logForDebugging(
					`executor client: skipping unparseable frame: ${errorMessage(e)}`,
				);
				idx = lineBuffer.indexOf("\n", lineOffset);
				continue;
			}
			handleFrame(parsed);
			idx = lineBuffer.indexOf("\n", lineOffset);
		}
		// Compact: when the unconsumed leftover prefix exceeds the threshold, cut it off in one go — amortized O(n), not per line.
		if (lineOffset > LINE_BUFFER_COMPACT_THRESHOLD) {
			lineBuffer = lineBuffer.slice(lineOffset);
			lineOffset = 0;
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
				// P2-4 (audit 0901): detached:true puts the executor in its own process group (pgid=proc.pid),
				// letting stop() use process.kill(-proc.pid) to tree-kill its subprocess tree (the bash children
				// the server spawned); otherwise proc.kill() only kills the top-level server → orphaned bash keeps running. detached
				// does not unref — lifecycle is still managed by stop()/exit-handler; only the process group membership changes.
				proc = spawn("fusion-executor", ["--serve", "--sock", socketPath], {
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...subprocessEnv(), FUSION_EXECUTOR_SOCK: socketPath },
					windowsHide: true,
					detached: true,
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
					// P1-7: already aborted → reject only this request, do not touch the shared socket.
					const pendingReq = pending.get(id);
					if (pendingReq) {
						pending.delete(id);
						pendingReq.reject(
							new Error("executor executeStream aborted before start"),
						);
					}
					throw new Error("executor executeStream aborted before start");
				}
				// P1-7: previously abort called failAllPending (destroying all in-flight) + socket.destroy
				// (destroying the shared UDS, rejecting all concurrent bash calls). Aborting a single stream must not destroy the global state.
				// Changed: reject only this id + send an executor.cancel RPC so the server kills the child;
				// the listener is removed when the promise settles (no leak of one listener per call).
				const onAbort = () => {
					const pendingReq = pending.get(id);
					if (pendingReq) {
						pending.delete(id);
						pendingReq.reject(new Error("executor executeStream aborted"));
					}
					// best-effort cancel RPC (server kills the child); does not wait for a reply, failure is fail-soft.
					try {
						sendRequest("executor.cancel", { id });
					} catch {
						// If the socket is already broken the cancel cannot be sent; this request is already rejected, no side effects.
					}
				};
				signal.addEventListener("abort", onAbort, { once: true });
				// Remove the listener after settle (both resolve/reject clean up, avoiding listener leaks).
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

		async writeFile(params: {
			path: string;
			content: string;
			cwd?: string;
		}): Promise<EditResult> {
			// #176 file-write delegation: raw UTF-8 byte write. Staleness/quote-norm/
			// patch already done client-side; executor only persists final bytes.
			// Fail-open in driver (transport error / ok:false → null → in-process).
			const { promise } = sendRequest("executor.write_file", params);
			return promise as Promise<EditResult>;
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
						// P2-4 (audit 0901): tree-kill the entire process group (executor server + its bash subtree).
						// The detached spawn makes proc.pid = pgid, so process.kill(-pid) kills the whole group.
						// SIGTERM first (graceful); if still not exited after P2_4_STOP_GRACE_MS, SIGKILL as backstop.
						try {
							process.kill(-proc.pid, "SIGTERM");
						} catch {
							// Process group missing/already exited (ESRCH) or permission denied → fall back to single-process kill.
							proc.kill();
						}
						await waitForProcessExit(proc, P2_4_STOP_GRACE_MS);
						if (!proc.killed) {
							try {
								process.kill(-proc.pid, "SIGKILL");
							} catch {
								proc.kill("SIGKILL");
							}
						}
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
