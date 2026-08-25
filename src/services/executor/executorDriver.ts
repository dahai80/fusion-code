// fusion-executor BashTool delegation seam — Phase 1.
// Routes foreground bash commands to the executor subprocess (Layer B "hands")
// via manager.getExecutorClient(). Constructs an ExecutionRequest, streams
// chunks → BashTool progress protocol, maps terminal ExecutionResult → ExecResult.
// isExecutorRouteable() gates: background (issue #1 — executor has no background)
// and simulated-sed stay on the in-process path. Fail-open: if no client, returns
// null so BashTool.call falls through to runShellCommand.

import { logForDebugging } from "../../utils/debug.js";
import type { ExecResult } from "../../utils/ShellCommand.js";
import { getDefaultBashTimeoutMs } from "../../utils/timeouts.js";
import { getExecutorClient, isExecutorEnabled } from "./manager.js";
import type {
	ExecutionRequest,
	ExecutionResult,
	ExecutorStreamChunk,
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
	return {
		command: input.command,
		task_id: toolUseId,
		timeout_sec: timeoutMs / 1000,
		enable_rollback_snapshot: true,
		auto_rollback_policy: undefined,
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
	let totalLines = 0;
	const startTime = Date.now();
	const abort = toolUseContext.abortController.signal;

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
					fullOutput += chunk.data;
					totalLines = fullOutput.split("\n").length;
					queue.push(chunk.data);
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
			yield makeProgress(fullOutput, totalLines, startTime);
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
	return mapResult(terminal);
}

function makeProgress(
	fullOutput: string,
	totalLines: number,
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
		output: fullOutput.slice(-4096),
		fullOutput,
		elapsedTimeSeconds: (Date.now() - startTime) / 1000,
		totalLines,
		totalBytes: fullOutput.length,
	};
}
