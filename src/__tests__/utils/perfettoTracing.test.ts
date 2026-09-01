// P2-4 (audit R20): traces 目录 prune 单测。
// pruneTracesDir 为纯函数 (参数 dir + caps), 无 envUtils 依赖, 直调无需 mock。

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pruneTracesDir } from "../../utils/telemetry/perfettoTracing.js";

// 触发 traces 写入需 feature('PERFETTO_TRACING') gate, 但 pruneTracesDir 已 export
// 且 gate 内调用。单测直调 helper, 验清理逻辑, 不经 gate (gate DCE 是 build 事)。
// 注意: import perfettoTracing.js 会执行顶层语句 (feature('PERFETTO_TRACING') 包裹
// 初始化, 默认关), 此处仅取 pruneTracesDir, 无副作用。

async function makeTrace(
	dir: string,
	name: string,
	sizeBytes: number,
	mtimeMsAgo: number,
): Promise<void> {
	const p = join(dir, name);
	// 写 sizeBytes 长度内容 (填充), 修正单测意义。
	await writeFile(p, "x".repeat(sizeBytes));
	const ago = mtimeMsAgo * 1000;
	const newMtime = new Date(Date.now() - ago);
	await writeFile(p, "x".repeat(sizeBytes), {});
	// fs utimes 改 mtime (跨平台)。
	const { utimes } = await import("fs/promises");
	const t = newMtime.getTime() / 1000;
	await utimes(p, t, t);
}

describe("pruneTracesDir (P2-4 / R20)", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "perfetto-prune-"));
	});
	afterEach(async () => {
		const { rm } = await import("fs/promises");
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	});

	it("count cap: keeps newest N, deletes oldest", async () => {
		// 7 文件, cap 5 → 删 2 最旧。
		const names = [
			"trace-a.json",
			"trace-b.json",
			"trace-c.json",
			"trace-d.json",
			"trace-e.json",
			"trace-f.json",
			"trace-g.json",
		];
		// 给递增 mtime (a 最旧, g 最新)。
		for (let i = 0; i < names.length; i++) {
			await makeTrace(dir, names[i], 100, (7 - i) * 60);
		}
		await pruneTracesDir(dir, 5, 50 * 1024 * 1024);
		const remaining = (await readdir(dir)).sort();
		expect(remaining).toEqual([
			"trace-c.json",
			"trace-d.json",
			"trace-e.json",
			"trace-f.json",
			"trace-g.json",
		]);
	});

	it("size cap: deletes oldest until total bytes under limit", async () => {
		// 4 文件 each 30KB = 120KB total, cap 50KB → 删最旧 3 个留 1? 50/30→留 1 (30<50), 删 3。
		const names = [
			"trace-old1.json",
			"trace-old2.json",
			"trace-old3.json",
			"trace-new.json",
		];
		for (let i = 0; i < names.length; i++) {
			await makeTrace(dir, names[i], 30 * 1024, (4 - i) * 60);
		}
		// count cap 设高 (10) 让 size cap 主导。
		await pruneTracesDir(dir, 10, 50 * 1024);
		const remaining = (await readdir(dir)).sort();
		// 留最新 1 (trace-new 30KB <= 50KB), 删 old1/old2/old3。
		expect(remaining).toEqual(["trace-new.json"]);
	});

	it("does not touch non-trace files", async () => {
		await makeTrace(dir, "trace-1.json", 100, 120);
		await makeTrace(dir, "trace-2.json", 100, 60);
		await writeFile(join(dir, "other.txt"), "keep me");
		await writeFile(join(dir, "config.json"), "keep me too");
		// cap 1 → 删 trace-1 (旧), 留 trace-2 + 非trace 文件。
		await pruneTracesDir(dir, 1, 50 * 1024 * 1024);
		const remaining = (await readdir(dir)).sort();
		expect(remaining).toContain("trace-2.json");
		expect(remaining).toContain("other.txt");
		expect(remaining).toContain("config.json");
		expect(remaining).not.toContain("trace-1.json");
	});

	it("empty / missing dir: no-op, no throw", async () => {
		// 空目录。
		await pruneTracesDir(dir, 5, 50 * 1024 * 1024);
		expect((await readdir(dir)).length).toBe(0);
		// 不存在目录。
		await expect(
			pruneTracesDir(join(dir, "nope"), 5, 50 * 1024 * 1024),
		).resolves.toBeUndefined();
	});

	it("under both caps: deletes nothing", async () => {
		await makeTrace(dir, "trace-1.json", 100, 60);
		await makeTrace(dir, "trace-2.json", 100, 30);
		await pruneTracesDir(dir, 20, 50 * 1024 * 1024);
		const remaining = (await readdir(dir)).sort();
		expect(remaining).toEqual(["trace-1.json", "trace-2.json"]);
	});
});
