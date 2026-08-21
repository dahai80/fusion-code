import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	performTrim,
	recoverTrimIfNeeded,
	shouldTrimTranscript,
} from "../../utils/sessionTranscript.js";

// --- helpers -----------------------------------------------------------------

let tmpDir: string;

async function makeTmp(): Promise<string> {
	const d = await mkdtemp(join(tmpdir(), "item6-trim-"));
	return d;
}

function userLine(uuid: string, text: string): string {
	return JSON.stringify({
		type: "user",
		uuid,
		message: { role: "user", content: [{ type: "text", text }] },
	});
}

function assistantLine(uuid: string, text: string): string {
	return JSON.stringify({
		type: "assistant",
		uuid,
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
}

function bigAssistantLine(uuid: string, size: number): string {
	const text = "x".repeat(size);
	return assistantLine(uuid, text);
}

function boundaryLine(uuid: string, preserved = false): string {
	return JSON.stringify({
		type: "system",
		uuid,
		subtype: "compact_boundary",
		...(preserved ? { compactMetadata: { preservedSegment: true } } : {}),
	});
}

function metadataLine(kind: string, uuid: string, value: string): string {
	// 与 METADATA_TYPE_MARKERS 对齐: {"type":"custom-title","uuid":...,"title":...} 等
	const payload: Record<string, unknown> = { type: kind, uuid };
	const valKey =
		kind === "custom-title"
			? "title"
			: kind === "tag"
				? "tag"
				: kind === "agent-name"
					? "agentName"
					: kind === "agent-color"
						? "agentColor"
						: kind === "agent-setting"
							? "agentSetting"
							: kind === "mode"
								? "mode"
								: kind === "worktree-state"
									? "worktreeState"
									: kind === "pr-link"
										? "prLink"
										: kind === "summary"
											? "summary"
											: "value";
	payload[valKey] = value;
	return JSON.stringify(payload);
}

async function writeJsonl(path: string, lines: string[]): Promise<void> {
	await writeFile(path, lines.map((l) => l).join("\n") + "\n");
}

async function readLines(path: string): Promise<string[]> {
	const { readFile } = await import("node:fs/promises");
	const content = await readFile(path, { encoding: "utf-8" });
	return content.split("\n").filter((l) => l.length > 0);
}

// --- setup/teardown ----------------------------------------------------------

beforeEach(async () => {
	tmpDir = await makeTmp();
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

describe("sessionTranscript item 6", () => {
	// 1. shouldTrimTranscript default off — env 未设 → {trim:false} (byte-identical 守)
	it("shouldTrimTranscript: env unset → trim:false (default off)", () => {
		delete process.env.FUSION_TRANSCRIPT_TRIM_THRESHOLD;
		const path = join(tmpDir, "noexist.jsonl");
		const decision = shouldTrimTranscript(path);
		expect(decision.trim).toBe(false);
		// size 0 因文件不存在, 不裁
		expect(decision.size).toBe(0);
	});

	// 2. shouldTrimTranscript threshold — 设 env + 文件 > 阈 → {trim:true}
	it("shouldTrimTranscript: env set + file > threshold → trim:true", async () => {
		process.env.FUSION_TRANSCRIPT_TRIM_THRESHOLD = "100";
		const path = join(tmpDir, "big.jsonl");
		await writeFile(path, bigAssistantLine("a1", 200));
		const decision = shouldTrimTranscript(path);
		expect(decision.trim).toBe(true);
		expect(decision.size).toBeGreaterThan(100);
		// 低于阈 → 不裁
		const smallPath = join(tmpDir, "small.jsonl");
		await writeFile(smallPath, userLine("u1", "hi"));
		expect(shouldTrimTranscript(smallPath).trim).toBe(false);
		delete process.env.FUSION_TRANSCRIPT_TRIM_THRESHOLD;
	});

	// 3. performTrim 基本裁剪 — pre-compact 段裁掉, 只留 [boundary, user2, assistant2]
	it("performTrim: trims pre-compact segment, keeps boundary + post-compact", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [
			userLine("u1", "old question"),
			bigAssistantLine("a1", 500),
			boundaryLine("b1"),
			userLine("u2", "after compact"),
			assistantLine("a2", "reply"),
		]);
		const origSize = (await stat(path)).size;
		const result = await performTrim(path);
		expect(result.trimmed).toBe(true);
		expect(result.origSize).toBe(origSize);
		expect(result.newSize).toBeLessThan(origSize);
		expect(result.trimmedBytes).toBe(origSize - result.newSize);
		// 磁盘只剩 boundary + user2 + assistant2
		const lines = await readLines(path);
		expect(lines.length).toBe(3);
		expect(JSON.parse(lines[0]).subtype).toBe("compact_boundary");
		expect(JSON.parse(lines[1]).uuid).toBe("u2");
		expect(JSON.parse(lines[2]).uuid).toBe("a2");
		// checkpoint 删除 (换成功后)
		await expect(stat(path + ".trim-checkpoint")).rejects.toThrow();
	});

	// 4. metadata 保留 — pre-boundary custom-title/agent-name/mode 行裁剪后留在文件头
	it("performTrim: preserves pre-boundary metadata at file head", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [
			metadataLine("custom-title", "t1", "My Session"),
			metadataLine("agent-name", "t2", "dev-agent"),
			metadataLine("mode", "t3", "normal"),
			userLine("u1", "old"),
			boundaryLine("b1"),
			userLine("u2", "new"),
		]);
		const result = await performTrim(path);
		expect(result.trimmed).toBe(true);
		const lines = await readLines(path);
		// 首 3 行 = metadata, 然后 boundary, 然后 user2
		expect(JSON.parse(lines[0]).type).toBe("custom-title");
		expect(JSON.parse(lines[1]).type).toBe("agent-name");
		expect(JSON.parse(lines[2]).type).toBe("mode");
		expect(JSON.parse(lines[3]).subtype).toBe("compact_boundary");
		expect(JSON.parse(lines[4]).uuid).toBe("u2");
	});

	// 5. preservedSegment boundary 不裁 — 防丢 preserved 消息
	it("performTrim: preservedSegment boundary → no trim (skip)", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [
			userLine("u1", "preserved-context"),
			boundaryLine("b1", true), // preservedSegment=true
			userLine("u2", "after"),
		]);
		const origSize = (await stat(path)).size;
		const result = await performTrim(path);
		expect(result.trimmed).toBe(false);
		expect(result.reason).toBe("no-trim-point");
		expect(result.newSize).toBe(origSize);
		// 文件不变
		const lines = await readLines(path);
		expect(lines.length).toBe(3);
	});

	// 6. 无 boundary 不裁 — 纯对话无可裁点
	it("performTrim: no compact_boundary → no trim (skip)", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [
			userLine("u1", "q1"),
			assistantLine("a1", "a1"),
			userLine("u2", "q2"),
		]);
		const origSize = (await stat(path)).size;
		const result = await performTrim(path);
		expect(result.trimmed).toBe(false);
		expect(result.reason).toBe("no-trim-point");
		expect(result.newSize).toBe(origSize);
	});

	// 7. 崩溃恢复 — checkpoint 存在 + 主文件 OK → 删 checkpoint 幂等; 主文件坏 → fail-visible 不删主
	it("recoverTrimIfNeeded: checkpoint+intact main → delete checkpoint (idempotent)", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [boundaryLine("b1"), userLine("u2", "after")]);
		// 伪造残留 checkpoint (裁剪完成但未删)
		await writeFile(
			path + ".trim-checkpoint",
			JSON.stringify({
				trimmedAt: "x",
				boundaryOffset: 0,
				origSize: 10,
				newSize: 5,
			}),
		);
		await recoverTrimIfNeeded(path);
		// checkpoint 被删, 主文件不动
		await expect(stat(path + ".trim-checkpoint")).rejects.toThrow();
		const lines = await readLines(path);
		expect(lines.length).toBe(2);
	});

	it("recoverTrimIfNeeded: checkpoint+corrupt main → fail-visible, keep checkpoint + main", async () => {
		const path = join(tmpDir, "s.jsonl");
		// 损坏主文件 (首行非 JSON)
		await writeFile(path, "CORRUPT GARBAGE\n{not json either}\n");
		await writeFile(
			path + ".trim-checkpoint",
			JSON.stringify({
				trimmedAt: "x",
				boundaryOffset: 0,
				origSize: 10,
				newSize: 5,
			}),
		);
		await recoverTrimIfNeeded(path);
		// checkpoint 保留作证, 主文件保留 (不静默删)
		const cpStat = await stat(path + ".trim-checkpoint");
		expect(cpStat.size).toBeGreaterThan(0);
		const mainStat = await stat(path);
		expect(mainStat.size).toBeGreaterThan(0);
	});

	// 8. default off 路径 — env 未设, recoverTrimIfNeeded no-op (checkpoint 永不存在)
	it("recoverTrimIfNeeded: no checkpoint → no-op (default off)", async () => {
		const path = join(tmpDir, "s.jsonl");
		await writeJsonl(path, [userLine("u1", "q"), assistantLine("a1", "a")]);
		const before = (await stat(path)).size;
		await recoverTrimIfNeeded(path);
		const after = (await stat(path)).size;
		expect(after).toBe(before); // 主文件不变
		// 无 checkpoint
		await expect(stat(path + ".trim-checkpoint")).rejects.toThrow();
	});
});
