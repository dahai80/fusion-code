import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	_setExecutorClientForTesting,
	callBashViaExecutor,
	type ExecutorClientLike,
	isExecutorRouteable,
} from "../../../services/executor/index.js";
import type {
	ExecutionRequest,
	ExecutionResult,
} from "../../../services/executor/index.js";
import type { ExecResult } from "../../../utils/ShellCommand.js";

// isExecutorRouteable reads isExecutorEnabled() (env gate). We toggle the env
// directly rather than mocking the manager — avoids mock.module cross-file
// pollution into manager.test.ts (Bun shares module cache across test files).
const ENV_KEY = "FUSION_CODE_EXECUTOR_ENABLED";
const AUTO_ROLLBACK_KEY = "FUSION_CODE_EXECUTOR_AUTO_ROLLBACK";

function makeResult(over: Partial<ExecutionResult> = {}): ExecutionResult {
	return {
		exit_code: 0,
		stdout: "",
		stderr: "",
		duration_sec: 0.1,
		timed_out: false,
		blocked_by_security: false,
		auto_rolled_back: false,
		...over,
	};
}

function makeClient(
	executeStream: ExecutorClientLike["executeStream"],
): ExecutorClientLike {
	return {
		executeStream,
		snapshotCreate: async () => ({ snapshot_id: "snap" }),
		rollback: async () => ({ ok: true }),
	};
}

// Drain an async generator to its terminal value (ExecResult | null), dropping
// intermediate progress frames. Mirrors the harness used by the existing tests.
async function drain(
	gen: AsyncGenerator<unknown, unknown, void>,
): Promise<ExecResult | null> {
	let terminal: ExecResult | null = null;
	while (true) {
		const r = await gen.next();
		if (r.done) {
			terminal = r.value as ExecResult | null;
			break;
		}
	}
	return terminal;
}

describe("executorDriver", () => {
	beforeEach(() => {
		_setExecutorClientForTesting(undefined);
		delete process.env[ENV_KEY];
		delete process.env[AUTO_ROLLBACK_KEY];
	});

	afterEach(() => {
		_setExecutorClientForTesting(undefined);
		delete process.env[ENV_KEY];
		delete process.env[AUTO_ROLLBACK_KEY];
	});

	describe("isExecutorRouteable", () => {
		it("returns false when disabled (env unset)", () => {
			delete process.env[ENV_KEY];
			expect(isExecutorRouteable({ command: "echo hi" })).toBe(false);
		});

		it("returns true when enabled + foreground + non-sed", () => {
			process.env[ENV_KEY] = "1";
			expect(isExecutorRouteable({ command: "echo hi" })).toBe(true);
		});

		it("returns false for run_in_background (issue #1 — executor has no background API)", () => {
			process.env[ENV_KEY] = "1";
			expect(
				isExecutorRouteable({ command: "sleep 100", run_in_background: true }),
			).toBe(false);
		});

		it("returns false for _simulatedSedEdit (stays on in-process sed path)", () => {
			process.env[ENV_KEY] = "1";
			expect(
				isExecutorRouteable({
					command: "sed -i s/a/b/",
					_simulatedSedEdit: {},
				}),
			).toBe(false);
		});

		it("returns true with explicit timeout set", () => {
			process.env[ENV_KEY] = "1";
			expect(isExecutorRouteable({ command: "ls", timeout: 5000 })).toBe(true);
		});
	});

	describe("callBashViaExecutor fail-open", () => {
		it("returns null when no client available (fail-open → in-process)", async () => {
			_setExecutorClientForTesting(undefined);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			const result = await gen.next();
			expect(result.done).toBe(true);
			expect(result.value).toBeNull();
		});
	});

	describe("callBashViaExecutor result mapping", () => {
		it("maps exit_code→code, stdout/stderr direct, timed_out→interrupted", async () => {
			_setExecutorClientForTesting(
				makeClient(async (_req, onChunk) => {
					onChunk({ type: "chunk", data: "hello\n" });
					return makeResult({ exit_code: 0, stdout: "hello\n", stderr: "" });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			let terminal: {
				stdout: string;
				stderr: string;
				code: number;
				interrupted: boolean;
			} | null = null;
			while (true) {
				const r = await gen.next();
				if (r.done) {
					terminal = r.value as {
						stdout: string;
						stderr: string;
						code: number;
						interrupted: boolean;
					} | null;
					break;
				}
			}
			expect(terminal).not.toBeNull();
			expect(terminal?.stdout).toBe("hello\n");
			expect(terminal?.stderr).toBe("");
			expect(terminal?.code).toBe(0);
			expect(terminal?.interrupted).toBe(false);
		});

		it("maps timeout result: timed_out=true → interrupted=true, exit_code passthrough", async () => {
			_setExecutorClientForTesting(
				makeClient(async () =>
					makeResult({ exit_code: -124, timed_out: true }),
				),
			);
			const gen = callBashViaExecutor(
				{ command: "sleep 100" },
				{ abortController: new AbortController() },
			);
			let terminal: { code: number; interrupted: boolean } | null = null;
			while (true) {
				const r = await gen.next();
				if (r.done) {
					terminal = r.value as { code: number; interrupted: boolean } | null;
					break;
				}
			}
			expect(terminal?.code).toBe(-124);
			expect(terminal?.interrupted).toBe(true);
		});

		it("maps blocked result: blocked_by_security true, exit_code -1 passthrough", async () => {
			_setExecutorClientForTesting(
				makeClient(async () =>
					makeResult({
						exit_code: -1,
						blocked_by_security: true,
						security_reason: "rm -rf",
					}),
				),
			);
			const gen = callBashViaExecutor(
				{ command: "rm -rf /" },
				{ abortController: new AbortController() },
			);
			let terminal: { code: number; stdout: string } | null = null;
			while (true) {
				const r = await gen.next();
				if (r.done) {
					terminal = r.value as { code: number; stdout: string } | null;
					break;
				}
			}
			expect(terminal?.code).toBe(-1);
			expect(terminal?.stdout).toBe("");
		});
	});

	describe("callBashViaExecutor streaming (chunk → progress)", () => {
		it("yields progress frames carrying accumulated fullOutput", async () => {
			_setExecutorClientForTesting(
				makeClient(async (_req, onChunk) => {
					onChunk({ type: "chunk", data: "line1\n" });
					onChunk({ type: "chunk", data: "line2\n" });
					return makeResult({ exit_code: 0, stdout: "line1\nline2\n" });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "seq 2" },
				{ abortController: new AbortController() },
			);
			const progressFrames: {
				output: string;
				fullOutput: string;
				totalLines: number;
			}[] = [];
			while (true) {
				const r = await gen.next();
				if (r.done) break;
				progressFrames.push(
					r.value as { output: string; fullOutput: string; totalLines: number },
				);
			}
			// Chunks drain as progress frames; the final frame carries the full
			// accumulated output (live UX preserved, output not lost on coalesce).
			expect(progressFrames.length).toBeGreaterThanOrEqual(1);
			const last = progressFrames[progressFrames.length - 1];
			expect(last.fullOutput).toBe("line1\nline2\n");
			expect(last.totalLines).toBe(3);
		});

		it("returns null when executeStream rejects (fail-open)", async () => {
			_setExecutorClientForTesting(
				makeClient(async () => {
					throw new Error("socket closed");
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			const r = await gen.next();
			expect(r.done).toBe(true);
			expect(r.value).toBeNull();
		});

		it("emits no progress frames for a command with no stdout chunks", async () => {
			_setExecutorClientForTesting(
				makeClient(async () => makeResult({ exit_code: 0, stdout: "" })),
			);
			const gen = callBashViaExecutor(
				{ command: "true" },
				{ abortController: new AbortController() },
			);
			const frames: unknown[] = [];
			while (true) {
				const r = await gen.next();
				if (r.done) break;
				frames.push(r.value);
			}
			expect(frames.length).toBe(0);
		});
	});

	describe("callBashViaExecutor Phase 2/3 passthrough (mapResult)", () => {
		it("preserves diagnostics on failure", async () => {
			_setExecutorClientForTesting(
				makeClient(async () =>
					makeResult({
						exit_code: 1,
						diagnostics: {
							error_type: "SyntaxError",
							file_path: "foo.py",
							line_number: 3,
							raw_trace: "SyntaxError: bad",
						},
					}),
				),
			);
			const gen = callBashViaExecutor(
				{ command: "python foo.py" },
				{ abortController: new AbortController() },
			);
			const terminal = await drain(gen);
			expect(terminal?.diagnostics?.error_type).toBe("SyntaxError");
			expect(terminal?.diagnostics?.file_path).toBe("foo.py");
			expect(terminal?.diagnostics?.line_number).toBe(3);
			expect(terminal?.diagnostics?.raw_trace).toBe("SyntaxError: bad");
		});

		it("leaves diagnostics undefined on success (byte-identical)", async () => {
			_setExecutorClientForTesting(
				makeClient(async () => makeResult({ exit_code: 0, stdout: "ok" })),
			);
			const gen = callBashViaExecutor(
				{ command: "echo ok" },
				{ abortController: new AbortController() },
			);
			const terminal = await drain(gen);
			expect(terminal?.diagnostics).toBeUndefined();
		});

		it("preserves snapshot_id", async () => {
			_setExecutorClientForTesting(
				makeClient(async () =>
					makeResult({ exit_code: 0, snapshot_id: "head:abc123" }),
				),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			const terminal = await drain(gen);
			expect(terminal?.snapshotId).toBe("head:abc123");
		});

		it("preserves auto_rolled_back", async () => {
			_setExecutorClientForTesting(
				makeClient(async () =>
					makeResult({ exit_code: 1, auto_rolled_back: true }),
				),
			);
			const gen = callBashViaExecutor(
				{ command: "false" },
				{ abortController: new AbortController() },
			);
			const terminal = await drain(gen);
			expect(terminal?.autoRolledBack).toBe(true);
		});
	});

	describe("callBashViaExecutor Phase 3 buildRequest (cwd + auto_rollback_policy)", () => {
		it("passes cwd in request", async () => {
			let captured: ExecutionRequest | undefined;
			_setExecutorClientForTesting(
				makeClient(async (req) => {
					captured = req;
					return makeResult({ exit_code: 0 });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			await drain(gen);
			expect(typeof captured?.cwd).toBe("string");
			expect(captured?.cwd?.length).toBeGreaterThan(0);
		});

		it("auto_rollback off by default (policy undefined)", async () => {
			let captured: ExecutionRequest | undefined;
			_setExecutorClientForTesting(
				makeClient(async (req) => {
					captured = req;
					return makeResult({ exit_code: 0 });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			await drain(gen);
			expect(captured?.auto_rollback_policy).toBeUndefined();
			expect(captured?.enable_rollback_snapshot).toBe(true);
		});

		it("auto_rollback on when env set (file_damage_check true)", async () => {
			process.env[AUTO_ROLLBACK_KEY] = "1";
			let captured: ExecutionRequest | undefined;
			_setExecutorClientForTesting(
				makeClient(async (req) => {
					captured = req;
					return makeResult({ exit_code: 0 });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			await drain(gen);
			expect(captured?.auto_rollback_policy).toBeDefined();
			expect(captured?.auto_rollback_policy?.file_damage_check).toBe(true);
		});

		it("enable_rollback_snapshot always true (regression Phase 1)", async () => {
			let captured: ExecutionRequest | undefined;
			_setExecutorClientForTesting(
				makeClient(async (req) => {
					captured = req;
					return makeResult({ exit_code: 0 });
				}),
			);
			const gen = callBashViaExecutor(
				{ command: "echo hi" },
				{ abortController: new AbortController() },
			);
			await drain(gen);
			expect(captured?.enable_rollback_snapshot).toBe(true);
		});
	});
});
