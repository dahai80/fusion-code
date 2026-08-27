// ExecCapability seam (ar-plan PR #4, S1.d).
// Provider-neutral exec facade — run(command) → Promise<ExecResult> behind one
// interface, with two swappable backends: in-process (Bun.spawn collect) and
// executor (callBashViaExecutor drain). Default-off (FUSION_CODE_CTX_EXEC_ENABLED);
// when undefined, byte-identical (no consumer calls it). Existing BashTool keeps
// its richer generator+progress routing UNTOUCHED — this seam is for future
// one-shot exec consumers (ctx-inspect helpers, code-search) that want a result
// without the BashTool orchestration layer.
import { spawn } from "node:child_process";
import type { ExecResult } from "../../../utils/ShellCommand.js";
import { logForDebugging } from "../../../utils/debug.js";

export interface ExecCapability {
	readonly backend: "in-process" | "executor";
	run(
		command: string,
		opts?: { cwd?: string; timeoutMs?: number },
	): Promise<ExecResult>;
}

// In-process one-shot: spawn, collect stdout/stderr, await exit. This is the
// existing primitive behind runShellCommand (which adds cwd/timeout/sandbox/
// state/progress on top); the seam only needs the result, so it collects
// directly. NOT a re-implementation of runShellCommand's orchestration.
export class InProcessExecCapability implements ExecCapability {
	readonly backend = "in-process" as const;
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async run(
		command: string,
		opts?: { cwd?: string; timeoutMs?: number },
	): Promise<ExecResult> {
		const cwd = opts?.cwd ?? this.cwd;
		const timeoutMs = opts?.timeoutMs ?? 120_000;
		return await new Promise<ExecResult>((resolve) => {
			const child = spawn(command, {
				cwd,
				shell: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
			}, timeoutMs);
			child.stdout?.on("data", (d) => (stdout += d.toString()));
			child.stderr?.on("data", (d) => (stderr += d.toString()));
			child.on("close", (code) => {
				clearTimeout(timer);
				const result: ExecResult = {
					stdout,
					stderr,
					code: code ?? 1,
					interrupted: timedOut,
				};
				logForDebugging(
					`[ctx.exec] in-process exit=${result.code} cmd=${command.slice(0, 80)}`,
				);
				resolve(result);
			});
			child.on("error", (err) => {
				clearTimeout(timer);
				logForDebugging(`[ctx.exec] in-process spawn error: ${err.message}`);
				resolve({
					stdout: "",
					stderr: err.message,
					code: 1,
					interrupted: false,
					preSpawnError: err.message,
				});
			});
		});
	}
}

// Executor-backed one-shot: drain callBashViaExecutor's generator to its
// terminal ExecResult. Fail-open mirrors BashTool: null (executor unavailable)
// → caller decides fallback (the seam returns a preSpawnError ExecResult rather
// than silently retrying, so the consumer sees the failure explicitly).
export class ExecutorExecCapability implements ExecCapability {
	readonly backend = "executor" as const;

	async run(
		command: string,
		opts?: { cwd?: string; timeoutMs?: number },
	): Promise<ExecResult> {
		const { callBashViaExecutor } = await import(
			"../../executor/executorDriver.js"
		);
		const gen = callBashViaExecutor(
			{ command, timeout: opts?.timeoutMs },
			{
				abortController: new AbortController(),
				toolUseId: "ctx-exec-seam",
			},
		);
		// Drain progress frames; capture the terminal return value.
		let terminal: ExecResult | null = null;
		while (true) {
			const step = await gen.next();
			if (step.done) {
				terminal = step.value;
				break;
			}
		}
		if (terminal === null) {
			logForDebugging(
				`[ctx.exec] executor unavailable (null), surfacing fail-open`,
			);
			return {
				stdout: "",
				stderr: "executor unavailable",
				code: 1,
				interrupted: false,
				preSpawnError: "executor unavailable",
			};
		}
		logForDebugging(
			`[ctx.exec] executor exit=${terminal.code} cmd=${command.slice(0, 80)}`,
		);
		return terminal;
	}
}
