// fusion-executor BashTool delegation seam — Phase 1.
// Routes foreground bash commands to the executor subprocess (Layer B "hands")
// via manager.getExecutorClient(). Constructs an ExecutionRequest, streams
// chunks → BashTool progress protocol, maps terminal ExecutionResult → ExecResult.
// isExecutorRouteable() gates: background (issue #1 — executor has no background)
// and simulated-sed stay on the in-process path. Fail-open: if no client, returns
// null so BashTool.call falls through to runShellCommand.

import { existsSync, lstatSync } from "node:fs";
import { getCwd } from "../../utils/cwd.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import type { ExecResult } from "../../utils/ShellCommand.js";
import { getDefaultBashTimeoutMs } from "../../utils/timeouts.js";
import { getExecutorClient, isExecutorEnabled } from "./manager.js";
import type {
	EditResult,
	ExecutionRequest,
	ExecutionResult,
	ExecutorStreamChunk,
	RollbackResult,
	SnapshotResult,
} from "./types.js";

// BashTool passes this shape (subset we need) — kept structural to avoid a
// hard import cycle into BashTool.tsx.
type BashInputLike = {
	command: string;
	timeout?: number;
	run_in_background?: boolean;
	_simulatedSedEdit?: unknown;
};

type ToolUseContextLike = {
	abortController: AbortController;
	toolUseId?: string;
};

// Phase 1 routing gate: enabled + foreground + not a simulated-sed edit.
// Background commands stay in-process (executor issue #1 — no background API).
export function isExecutorRouteable(input: BashInputLike): boolean {
	if (!isExecutorEnabled()) return false;
	if (input.run_in_background) return false;
	if (input._simulatedSedEdit) return false;
	return true;
}

export function logExecutorFallback(command: string): void {
	const head = command.split("\n")[0]?.slice(0, 80) ?? "";
	logForDebugging(
		`executor fallback to in-process bash (unavailable): ${head}`,
	);
}

// Map executor terminal result → BashTool ExecResult.
// exit_code: 0=ok, -124=timeout, -1=blocked/internal. ShellCommand SIGKILL=137,
// SIGTERM=143 but executor uses negative codes, so pass exit_code through and
// set interrupted from timed_out. stderr is empty in PTY-merged mode but map it.
function mapResult(res: ExecutionResult): ExecResult {
	return {
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		code: res.exit_code,
		interrupted: res.timed_out,
		// Phase 2/3: preserve sliced diagnostics + git snapshot/rollback state.
		// diagnostics carries the server-side traceback slice (error_type /
		// file_path:line / code_snippet / raw_trace). autoRolledBack/snapshotId
		// carry Phase 3 git-rollback state. All undefined on the in-process path.
		diagnostics: res.diagnostics,
		autoRolledBack: res.auto_rolled_back,
		snapshotId: res.snapshot_id,
	};
}

// Build the wire request from BashTool input. timeout_sec = ms→s; seatbelt off
// for Phase 1 (fusion-code's own sandbox gates separately; enabling executor's
// seatbelt would double-isolate). Snapshot on, auto-rollback off (Phase 3 opt-in).
function buildRequest(
	input: BashInputLike,
	toolUseId?: string,
): ExecutionRequest {
	const timeoutMs = input.timeout || getDefaultBashTimeoutMs();
	const autoRollback = isEnvTruthy(
		process.env.FUSION_CODE_EXECUTOR_AUTO_ROLLBACK,
	);
	return {
		command: input.command,
		task_id: toolUseId,
		cwd: getCwd(),
		timeout_sec: timeoutMs / 1000,
		enable_rollback_snapshot: true,
		auto_rollback_policy: autoRollback
			? { max_consecutive_failures: 0, file_damage_check: true }
			: undefined,
		seatbelt: false,
	};
}

// Test injection seam: when set, callBashViaExecutor uses this client instead
// of the real manager singleton. Lets tests exercise the stream→progress bridge
// and result mapping without a real fusion-executor subprocess or UDS.
export type ExecutorClientLike = {
	executeStream: (
		req: ExecutionRequest,
		onChunk: (chunk: ExecutorStreamChunk) => void,
		signal?: AbortSignal,
	) => Promise<ExecutionResult>;
	snapshotCreate: (cwd: string) => Promise<SnapshotResult>;
	rollback: (snapshotId: string, cwd: string) => Promise<RollbackResult>;
	writeFile?: (params: {
		path: string;
		content: string;
		cwd?: string;
	}) => Promise<EditResult>;
};

let _testClient: ExecutorClientLike | undefined;
export function _setExecutorClientForTesting(
	client: ExecutorClientLike | undefined,
): void {
	_testClient = client;
}

// Delegate a foreground bash call to the executor. Returns an async generator
// yielding progress events (matching runShellCommand's shape) and resolving to
// the terminal ExecResult, OR null if the executor is unavailable (fail-open →
// caller falls back to in-process runShellCommand).
//
// The executor's onChunk is a callback; this generator needs to yield those
// chunks live. Bridge with a queue: the callback pushes, the generator drains.
export async function* callBashViaExecutor(
	input: BashInputLike,
	toolUseContext: ToolUseContextLike,
): AsyncGenerator<
	{
		type: "progress";
		output: string;
		fullOutput: string;
		elapsedTimeSeconds: number;
		totalLines: number;
		totalBytes?: number;
	},
	ExecResult | null,
	void
> {
	const client = _testClient ?? getExecutorClient();
	if (!client) {
		return null;
	}

	const req = buildRequest(input, toolUseContext.toolUseId);
	let fullOutput = "";
	let totalLines = 1; // P3-3: split("\n").length = 段数 = 换行数+1, 初始化 1 匹配段语义
	let totalBytes = 0; // P3-3: 真实字节数 (不受 cap 截断影响, 反映命令实际输出量)
	let outputTruncated = false; // P3-3: fullOutput 超 cap 截断标志
	const startTime = Date.now();
	const abort = toolUseContext.abortController.signal;
	// P3-3 (audit 0901): fullOutput 无界累积 → GB 级输出 (find /, 大 log) OOM 崩进程。
	// 超过 FULL_OUTPUT_MAX_BYTES 后停止拼接, 仅保留尾部窗口供显示 (output: slice(-4096)),
	// 置 outputTruncated=true 让上层知道输出被截断。totalBytes 继续累真实量 (不受 cap 影响)。
	const FULL_OUTPUT_MAX_BYTES = Number.isFinite(
		parseInt(process.env.FUSION_CODE_EXECUTOR_OUTPUT_MAX_BYTES ?? "", 10),
	)
		? parseInt(process.env.FUSION_CODE_EXECUTOR_OUTPUT_MAX_BYTES ?? "", 10)
		: 10 * 1024 * 1024; // 10MB cap

	// Queue bridge: onChunk pushes chunk strings; generator drains them as
	// progress frames. drainResolve is just a wake signal — the generator
	// re-checks the queue in its loop, so the callback never yields directly.
	const queue: string[] = [];
	let streamDone = false;
	let streamError: Error | undefined;
	let terminal: ExecutionResult | undefined;
	let drainResolve: (() => void) | undefined;

	const wake = (): void => {
		if (drainResolve) {
			const r = drainResolve;
			drainResolve = undefined;
			r();
		}
	};

	const streamPromise = client
		.executeStream(
			req,
			(chunk: ExecutorStreamChunk) => {
				if (chunk.type === "chunk") {
					const data = chunk.data;
					// P3-3: totalBytes 累真实量 (不受 cap 影响), totalLines 增量计 (避免每 chunk O(n) split)。
					totalBytes += data.length;
					for (let i = 0; i < data.length; i++) {
						if (data.charCodeAt(i) === 10) totalLines++;
					}
					// P3-3: 超 cap 后停止全量拼接, 仅保滚动尾部窗口 (边收边弃), 防 GB 级输出 OOM。
					// fullOutput 上限 ~2*cap, 超 2*cap 才 trim 到 cap → 摊还 O(n), 非每 chunk O(n)。
					if (!outputTruncated && fullOutput.length + data.length > FULL_OUTPUT_MAX_BYTES) {
						outputTruncated = true;
						logForDebugging(
							`executor output exceeded ${FULL_OUTPUT_MAX_BYTES} bytes (totalBytes=${totalBytes}) — switching to tail window`,
						);
					}
					fullOutput += data;
					if (outputTruncated && fullOutput.length > FULL_OUTPUT_MAX_BYTES * 2) {
						fullOutput = fullOutput.slice(-FULL_OUTPUT_MAX_BYTES);
					}
					queue.push(data);
					wake();
				}
			},
			abort,
		)
		.then((res) => {
			terminal = res;
		})
		.catch((err) => {
			streamError = err as Error;
		})
		.finally(() => {
			streamDone = true;
			wake();
		});

	// Drain queued chunks as progress frames until the stream completes.
	while (!streamDone || queue.length > 0) {
		if (queue.length > 0) {
			yield makeProgress(fullOutput, totalLines, totalBytes, startTime);
			queue.length = 0;
		} else if (!streamDone) {
			// Wait for the next chunk push (wake) or stream completion.
			await new Promise<void>((resolve) => {
				drainResolve = resolve;
			});
		}
	}

	// Stream finished — await to surface any error, then map terminal result.
	await streamPromise;
	if (streamError) {
		logForDebugging(`executor executeStream failed: ${streamError.message}`);
		return null;
	}
	if (!terminal) {
		logForDebugging("executor executeStream returned no terminal result");
		return null;
	}
	// Phase 2/3: log diagnostics + rollback state for problem location. These
	// only populate on the executor route; absent (no log) on the in-process path.
	if (terminal.exit_code !== 0 && terminal.diagnostics) {
		const d = terminal.diagnostics;
		logForDebugging(
			`executor diagnostics: type=${d.error_type ?? "?"} file=${d.file_path ?? "?"}:${d.line_number ?? "?"}`,
		);
	}
	if (terminal.auto_rolled_back) {
		logForDebugging(
			`executor auto-rolled-back command (snapshot=${terminal.snapshot_id ?? "n/a"})`,
		);
	}
	return mapResult(terminal);
}

function makeProgress(
	fullOutput: string,
	totalLines: number,
	totalBytes: number,
	startTime: number,
): {
	type: "progress";
	output: string;
	fullOutput: string;
	elapsedTimeSeconds: number;
	totalLines: number;
	totalBytes?: number;
} {
	return {
		type: "progress",
		// P3-3: fullOutput 超 cap 后仅保尾部窗口, output slice 仍取末 4KB 供实时显示。
		output: fullOutput.slice(-4096),
		fullOutput,
		elapsedTimeSeconds: (Date.now() - startTime) / 1000,
		totalLines,
		// P3-3: totalBytes 反映命令真实输出量 (不受 cap 截断影响), 而非 fullOutput.length。
		totalBytes,
	};
}

// #176 file-write delegation — delegate ONLY the final disk-write step
// (writeTextContent), AFTER fusion-code completes staleness/quote-norm/patch/
// LSP coordination. Executor write_file writes raw UTF-8 bytes (no CRLF-norm,
// no encoding, no symlink-preserve). Fail-open to in-process writeTextContent
// on ANY divergence (non-utf8, symlink, >64MB, transport error, ok:false).
export function isFileWriteRouteable(): boolean {
	return isExecutorEnabled();
}

export type CallWriteParams = {
	filePath: string;
	content: string;
	encoding: BufferEncoding;
	endings: "LF" | "CRLF";
};

// Returns EditResult (ok:true) on executor success, null on ANY failure
// (fail-open). Caller does in-process writeTextContent when result is null.
export async function callWriteViaExecutor(
	params: CallWriteParams,
): Promise<EditResult | null> {
	if (!isFileWriteRouteable()) return null;
	// divergent cases → fail-open to in-process (which handles them correctly)
	if (params.encoding !== "utf8") {
		logForDebugging(
			`[Executor] write skip: non-utf8 encoding "${params.encoding}" → in-process`,
		);
		return null;
	}
	let isSymlink = false;
	try {
		if (existsSync(params.filePath)) {
			isSymlink = lstatSync(params.filePath).isSymbolicLink();
		}
	} catch {
		return null; // stat failed → don't route
	}
	if (isSymlink) {
		logForDebugging(
			"[Executor] write skip: symlink path → in-process (preserve link)",
		);
		return null;
	}
	// CRLF-normalize client-side (executor write_file writes raw bytes)
	let toWrite = params.content;
	if (params.endings === "CRLF") {
		toWrite = params.content.replaceAll("\r\n", "\n").split("\n").join("\r\n");
	}
	if (Buffer.byteLength(toWrite, "utf8") > 64 * 1024 * 1024) {
		logForDebugging("[Executor] write skip: >64MB → in-process");
		return null;
	}
	const client = _testClient ?? getExecutorClient();
	if (!client?.writeFile) return null;
	try {
		const result = await client.writeFile({
			path: params.filePath,
			content: toWrite,
			cwd: getCwd(),
		});
		if (!result?.ok) {
			logForDebugging(
				`[Executor] write_file failed: ${result?.error ?? "unknown"} → in-process`,
			);
			return null;
		}
		return result;
	} catch (error) {
		logForDebugging(
			`[Executor] write_file transport error: ${(error as Error).message} → in-process`,
		);
		return null;
	}
}
