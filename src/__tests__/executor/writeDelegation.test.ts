import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_setExecutorClientForTesting,
	type CallWriteParams,
	callWriteViaExecutor,
	isFileWriteRouteable,
} from "../../services/executor/executorDriver.js";
import type { EditResult } from "../../services/executor/types.js";

// #176 file-write delegation: callWriteViaExecutor delegates ONLY the final
// disk-write step to the executor subprocess, fail-open (null) on ANY failure.
// Tests exercise the routing + mitigation gates via the test-injection seam
// (_setExecutorClientForTesting) — no real fusion-executor subprocess needed.

const ENV_KEY = "FUSION_CODE_EXECUTOR_ENABLED";

type WriteCall = { path: string; content: string; cwd?: string };

function makeClient(impl: (p: WriteCall) => Promise<EditResult>): {
	client: { writeFile: typeof impl };
	calls: WriteCall[];
} {
	const calls: WriteCall[] = [];
	const client = {
		writeFile: (async (p: WriteCall) => {
			calls.push(p);
			return impl(p);
		}) as typeof impl,
	};
	return { client, calls };
}

function baseParams(over: Partial<CallWriteParams> = {}): CallWriteParams {
	return {
		filePath: join(tmpdir(), `fw-${Math.random().toString(36).slice(2)}.txt`),
		content: "hello\n",
		encoding: "utf8",
		endings: "LF",
		...over,
	};
}

describe("#176 callWriteViaExecutor", () => {
	let envSnap: string | undefined;
	let tmpDir: string;

	beforeEach(() => {
		envSnap = process.env[ENV_KEY];
		tmpDir = mkdtempSync(join(tmpdir(), "fwd-"));
	});

	afterEach(() => {
		if (envSnap === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = envSnap;
		_setExecutorClientForTesting(undefined);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("isFileWriteRouteable false when env unset", () => {
		delete process.env[ENV_KEY];
		expect(isFileWriteRouteable()).toBe(false);
	});

	test("isFileWriteRouteable true when env set", () => {
		process.env[ENV_KEY] = "1";
		expect(isFileWriteRouteable()).toBe(true);
	});

	test("returns null when env unset (byte-identical-off, fail-open)", async () => {
		delete process.env[ENV_KEY];
		const { client } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		const out = await callWriteViaExecutor(baseParams());
		expect(out).toBeNull();
	});

	test("returns EditResult{ok:true} on executor success", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => ({
			ok: true,
			path: "/x",
			matches: 1,
		}));
		_setExecutorClientForTesting(client as never);
		const out = await callWriteViaExecutor(baseParams());
		expect(out).not.toBeNull();
		expect(out?.ok).toBe(true);
	});

	test("returns null when no client (fail-open)", async () => {
		process.env[ENV_KEY] = "1";
		// no testClient injected, manager uninitialized → getExecutorClient() undefined
		const out = await callWriteViaExecutor(baseParams());
		expect(out).toBeNull();
	});

	test("returns null when client.writeFile throws (fail-open)", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => {
			throw new Error("transport down");
		});
		_setExecutorClientForTesting(client as never);
		const out = await callWriteViaExecutor(baseParams());
		expect(out).toBeNull();
	});

	test("returns null when client.writeFile returns ok:false (fail-open)", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => ({
			ok: false,
			error: "EACCES",
		}));
		_setExecutorClientForTesting(client as never);
		const out = await callWriteViaExecutor(baseParams());
		expect(out).toBeNull();
	});

	test("returns null for non-utf8 encoding (fail-open)", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		const out = await callWriteViaExecutor(baseParams({ encoding: "utf16le" }));
		expect(out).toBeNull();
	});

	test("returns null for symlink path (fail-open, preserve link)", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		const target = join(tmpDir, "target.txt");
		writeFileSync(target, "t");
		const link = join(tmpDir, "link.txt");
		symlinkSync(target, link);
		const out = await callWriteViaExecutor(baseParams({ filePath: link }));
		expect(out).toBeNull();
	});

	test("returns null for content > 64MB (fail-open)", async () => {
		process.env[ENV_KEY] = "1";
		const { client } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		const big = "a".repeat(64 * 1024 * 1024 + 1);
		const out = await callWriteViaExecutor(baseParams({ content: big }));
		expect(out).toBeNull();
	});

	test("CRLF-normalizes content before sending", async () => {
		process.env[ENV_KEY] = "1";
		const { client, calls } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		// input has lone \n; endings CRLF → executor receives \r\n
		await callWriteViaExecutor(
			baseParams({ content: "line1\nline2\n", endings: "CRLF" }),
		);
		expect(calls[0].content).toBe("line1\r\nline2\r\n");
	});

	test("passes cwd from getCwd()", async () => {
		process.env[ENV_KEY] = "1";
		const { client, calls } = makeClient(async () => ({ ok: true }));
		_setExecutorClientForTesting(client as never);
		await callWriteViaExecutor(baseParams());
		expect(calls[0].cwd).toBe(process.cwd());
	});
});
