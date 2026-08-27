import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { InProcessExecCapability, ExecutorExecCapability } = await import(
	"../../../../services/llm/capabilities/exec.js"
);

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "ctx-exec-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("InProcessExecCapability", () => {
	test("backend is in-process", () => {
		expect(new InProcessExecCapability(tmpDir).backend).toBe("in-process");
	});

	test("run('echo hi') → code 0, stdout contains hi", async () => {
		const cap = new InProcessExecCapability(tmpDir);
		const res = await cap.run("echo hi");
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toBe("hi");
		expect(res.interrupted).toBe(false);
	});

	test("non-zero exit propagates code", async () => {
		const cap = new InProcessExecCapability(tmpDir);
		const res = await cap.run("exit 7");
		expect(res.code).toBe(7);
	});

	test("stderr captured from failing command", async () => {
		const cap = new InProcessExecCapability(tmpDir);
		const res = await cap.run("echo oops 1>&2; exit 3");
		expect(res.code).toBe(3);
		expect(res.stderr.trim()).toBe("oops");
	});

	test("cwd option overrides constructor cwd", async () => {
		const cap = new InProcessExecCapability(tmpDir);
		await writeFile(join(tmpDir, "marker.txt"), "in-cwd", "utf8");
		const res = await cap.run("cat marker.txt", { cwd: tmpDir });
		expect(res.code).toBe(0);
		expect(res.stdout.trim()).toBe("in-cwd");
	});

	test("timeoutMs kills long command → interrupted true", async () => {
		const cap = new InProcessExecCapability(tmpDir);
		const res = await cap.run("sleep 5", { timeoutMs: 200 });
		// SIGTERM → non-zero exit, interrupted flag set.
		expect(res.interrupted).toBe(true);
		expect(res.code).not.toBe(0);
	});
});

describe("ExecutorExecCapability", () => {
	test("backend is executor", () => {
		expect(new ExecutorExecCapability().backend).toBe("executor");
	});

	test("run with executor disabled → fail-open preSpawnError (executor unavailable)", async () => {
		// The executor subprocess is not routable in CI (no socket / not enabled),
		// so callBashViaExecutor drains to a null terminal → seam surfaces the
		// fail-open ExecResult with preSpawnError set, not a thrown error.
		const cap = new ExecutorExecCapability();
		const res = await cap.run("echo hi");
		// Either the executor answered (code 0, stdout hi) or it was unavailable
		// (preSpawnError). Both are valid fail-open outcomes; assert the contract
		// holds in either branch rather than assuming CI socket state.
		if (res.preSpawnError) {
			expect(res.code).not.toBe(0);
			expect(res.preSpawnError).toBe("executor unavailable");
		} else {
			expect(res.code).toBe(0);
		}
	});
});
