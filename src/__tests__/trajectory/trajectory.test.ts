// D1 轨迹飞轮 — 收集 + 导出 测试 (issue #50/#51)
//
// 用临时目录构造 session jsonl, 跑 collect → export 三格式, 校验输出结构。

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	collectTrajectories,
	readManifest,
} from "../../services/trajectory/collector.js";
import {
	exportTrajectories,
	toSFTSample,
	toGRPOSample,
	buildDPOPairs,
} from "../../services/trajectory/exporters.js";
import type {
	CollectedTrajectory,
	TrajectoryStep,
} from "../../services/trajectory/types.js";

let tmpRoot: string;
let sourceDir: string;
let destDir: string;

// 构造一条 assistant 事件 (text + 可选 tool_use)
function assistantEvent(
	text: string,
	toolUse?: { id: string; name: string; input: unknown },
) {
	const content: unknown[] = [];
	if (text) content.push({ type: "text", text });
	if (toolUse) content.push({ type: "tool_use", ...toolUse });
	return { type: "assistant", message: { role: "assistant", content } };
}

// 构造一条 user 事件 (纯文本 或 tool_result)
function userEvent(
	text: string,
	toolResult?: { toolUseId: string; isError: boolean; content: string },
) {
	if (toolResult) {
		return {
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: toolResult.toolUseId,
						is_error: toolResult.isError,
						content: toolResult.content,
					},
				],
			},
		};
	}
	return { type: "user", message: { role: "user", content: text } };
}

function line(obj: unknown): string {
	return JSON.stringify(obj);
}

async function writeSession(
	cwdSlug: string,
	sessionId: string,
	events: unknown[],
): Promise<void> {
	const dir = path.join(sourceDir, cwdSlug);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, sessionId + ".jsonl"),
		events.map((e) => line(e)).join("\n") + "\n",
		"utf8",
	);
}

beforeEach(async () => {
	tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "traj-"));
	sourceDir = path.join(tmpRoot, "projects");
	destDir = path.join(tmpRoot, "trajectories");
	await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("collectTrajectories", () => {
	it("labels error-free session as positive", async () => {
		await writeSession("proj-a", "sess-ok", [
			userEvent("fix the bug in foo.ts"),
			assistantEvent("I will read the file", {
				id: "tu1",
				name: "Read",
				input: { file_path: "/p/foo.ts" },
			}),
			userEvent("", {
				toolUseId: "tu1",
				isError: false,
				content: "file contents here",
			}),
			assistantEvent("The fix is to add a null check."),
		]);

		const manifest = await collectTrajectories({
			sourceDir,
			destDir,
			product: "fusion-code",
		});

		expect(manifest.totals.sessions).toBe(1);
		expect(manifest.totals.positive).toBe(1);
		expect(manifest.totals.selfCorrection).toBe(0);
		expect(manifest.totals.toolUse).toBe(1);
		expect(manifest.totals.toolError).toBe(0);
		expect(manifest.sessions[0].label).toBe("positive");
	});

	it("labels session with tool_error as self_correction", async () => {
		await writeSession("proj-b", "sess-err", [
			userEvent("run the tests"),
			assistantEvent("running tests", {
				id: "tu1",
				name: "Bash",
				input: { command: "pytest" },
			}),
			userEvent("", {
				toolUseId: "tu1",
				isError: true,
				content: "command not found: pytest",
			}),
			assistantEvent("pytest is not installed. I will use bun test."),
		]);

		const manifest = await collectTrajectories({
			sourceDir,
			destDir,
		});

		expect(manifest.totals.sessions).toBe(1);
		expect(manifest.totals.positive).toBe(0);
		expect(manifest.totals.selfCorrection).toBe(1);
		expect(manifest.totals.toolError).toBe(1);
		expect(manifest.sessions[0].label).toBe("self_correction");
	});

	it("writes raw jsonl and manifest to dest", async () => {
		await writeSession("proj-c", "sess-1", [
			userEvent("hello"),
			assistantEvent("hi there"),
		]);

		await collectTrajectories({ sourceDir, destDir });

		const manifest = await readManifest(destDir);
		expect(manifest).not.toBeNull();
		expect(manifest?.version).toBe(1);
		const rawFile = path.join(destDir, "raw", "fusion-code-sess-1.jsonl");
		const raw = await fs.readFile(rawFile, "utf8");
		const steps = raw
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as TrajectoryStep);
		expect(steps.length).toBe(2);
		expect(steps[0].role).toBe("user");
		expect(steps[1].role).toBe("assistant");
	});

	it("skips empty sessions", async () => {
		await writeSession("proj-d", "sess-empty", [
			{ type: "system", message: { role: "system", content: "init" } },
		]);
		const manifest = await collectTrajectories({ sourceDir, destDir });
		expect(manifest.totals.sessions).toBe(0);
	});
});

describe("exportTrajectories", () => {
	async function seedTwoSessions(): Promise<void> {
		await writeSession("proj-a", "sess-ok", [
			userEvent("explain closures"),
			assistantEvent("A closure captures variables.", {
				id: "tu1",
				name: "Read",
				input: { file_path: "/p/x.ts" },
			}),
			userEvent("", {
				toolUseId: "tu1",
				isError: false,
				content: "ok",
			}),
			assistantEvent(
				"Final answer: a closure is a function with captured scope.",
			),
		]);
		await writeSession("proj-b", "sess-err", [
			userEvent("fix bug"),
			assistantEvent("trying edit", {
				id: "tu1",
				name: "Edit",
				input: { file_path: "/p/y.ts" },
			}),
			userEvent("", {
				toolUseId: "tu1",
				isError: true,
				content: "old_string not found",
			}),
			assistantEvent("Let me re-read and retry with correct old_string."),
		]);
		await collectTrajectories({ sourceDir, destDir });
	}

	// export 的 sourceDir = 轨迹汇聚库 (collect 的 destDir), destDir = 输出目录
	it("SFT exports only positive trajectories as ShareGPT messages", async () => {
		await seedTwoSessions();
		const res = await exportTrajectories({
			sourceDir: destDir,
			destDir,
			format: "sft",
		});
		expect(res.format).toBe("sft");
		expect(res.count).toBe(1); // only the positive one
		const out = (await fs.readFile(res.destFile, "utf8")).trim().split("\n");
		const sample = JSON.parse(out[0]);
		expect(sample.messages).toBeDefined();
		expect(sample.messages.length).toBe(3);
		expect(sample.messages[0].role).toBe("system");
		expect(sample.messages[1].role).toBe("user");
		expect(sample.messages[2].role).toBe("assistant");
	});

	it("DPO exports self_correction pairs", async () => {
		await seedTwoSessions();
		const res = await exportTrajectories({
			sourceDir: destDir,
			destDir,
			format: "dpo",
		});
		expect(res.format).toBe("dpo");
		expect(res.count).toBe(1); // one self_correction session
		const out = (await fs.readFile(res.destFile, "utf8")).trim().split("\n");
		const pair = JSON.parse(out[0]);
		expect(pair.prompt).toBeDefined();
		expect(pair.chosen).toBeDefined();
		expect(pair.rejected).toBeDefined();
		// chosen is the final successful answer, rejected contains the failed tool
		expect(pair.chosen).toContain("re-read");
		expect(pair.rejected).toContain("trying edit");
	});

	it("GRPO exports every trajectory with reward 0/1", async () => {
		await seedTwoSessions();
		const res = await exportTrajectories({
			sourceDir: destDir,
			destDir,
			format: "grpo",
		});
		expect(res.format).toBe("grpo");
		expect(res.count).toBe(2); // all trajectories
		const out = (await fs.readFile(res.destFile, "utf8")).trim().split("\n");
		const rewards = out.map((l) => JSON.parse(l).reward as number).sort();
		expect(rewards).toEqual([0, 1]);
	});
});

describe("exporter unit transforms", () => {
	function mkTraj(
		label: "positive" | "self_correction",
		steps: TrajectoryStep[],
	): CollectedTrajectory {
		return {
			source: "/fake/sess.jsonl",
			sessionId: "sess-x",
			product: "fusion-code",
			steps,
			label,
			toolUseCount: 0,
			toolErrorCount: label === "self_correction" ? 1 : 0,
			hasSubagents: false,
		};
	}

	it("toSFTSample returns null for self_correction", () => {
		const traj = mkTraj("self_correction", [
			{ role: "user", text: "q" },
			{ role: "assistant", text: "a" },
		]);
		expect(toSFTSample(traj)).toBeNull();
	});

	it("toSFTSample returns messages for positive", () => {
		const traj = mkTraj("positive", [
			{ role: "user", text: "what is 1+1" },
			{ role: "assistant", text: "2" },
		]);
		const s = toSFTSample(traj);
		expect(s).not.toBeNull();
		expect(s?.messages[1].content).toBe("what is 1+1");
		expect(s?.messages[2].content).toBe("2");
	});

	it("toGRPOSample reward matches label", () => {
		const pos = mkTraj("positive", [
			{ role: "user", text: "q" },
			{ role: "assistant", text: "a" },
		]);
		const neg = mkTraj("self_correction", [
			{ role: "user", text: "q" },
			{ role: "assistant", text: "a" },
		]);
		expect(toGRPOSample(pos)?.reward).toBe(1);
		expect(toGRPOSample(neg)?.reward).toBe(0);
	});

	it("buildDPOPairs only emits for self_correction", () => {
		const pos = mkTraj("positive", [
			{ role: "user", text: "q" },
			{ role: "assistant", text: "good" },
		]);
		const sc = mkTraj("self_correction", [
			{ role: "user", text: "q" },
			{ role: "assistant", text: "bad attempt" },
			{
				role: "user",
				text: "",
				toolResults: [{ toolUseId: "1", isError: true, content: "err" }],
			},
			{ role: "assistant", text: "correct final answer" },
		]);
		const pairs = buildDPOPairs([pos, sc]);
		expect(pairs.length).toBe(1);
		expect(pairs[0].chosen).toBe("correct final answer");
	});
});
