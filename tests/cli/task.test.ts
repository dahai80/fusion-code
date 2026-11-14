import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Evolution plan P2.1: task start → detached worker → worktree commit →
// push → PR hand-back → structured result summary in the task record.
// Uses a stub fusion binary (records the headless result, makes a file
// change) and a stub gh; origin is a local bare repo so push succeeds.

const origCwd = process.cwd();
const tempDirs: string[] = [];
let repoDir = "";
let originDir = "";
let configDir = "";
let stubFusion = "";
let stubGh = "";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { ok: proc.status === 0, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

function readRecord(id: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(configDir, "tasks", `${id}.json`), "utf8"),
	) as Record<string, unknown>;
}

async function waitForStatus(id: string, terminal: string[], timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const record = readRecord(id);
		const status = record.status as string;
		if (terminal.includes(status)) return status;
		if (Date.now() > deadline) return `timeout:${status}`;
		await new Promise((r) => setTimeout(r, 300));
	}
}

beforeAll(async () => {
	configDir = mkdtempSync(join(tmpdir(), "fc-task-cfg-"));
	tempDirs.push(configDir);
	originDir = mkdtempSync(join(tmpdir(), "fc-task-origin-"));
	tempDirs.push(originDir);
	repoDir = mkdtempSync(join(tmpdir(), "fc-task-repo-"));
	tempDirs.push(repoDir);
	// Bare origin + seed repo
	spawnSync("git", ["init", "--bare", "-q", originDir]);
	git(repoDir, ["init", "-q"]);
	git(repoDir, ["config", "user.email", "test@example.com"]);
	git(repoDir, ["config", "user.name", "Task Test"]);
	writeFileSync(join(repoDir, "seed.txt"), "seed\n");
	git(repoDir, ["add", "-A"]);
	git(repoDir, ["commit", "-q", "-m", "seed"]);
	git(repoDir, ["remote", "add", "origin", originDir]);
	git(repoDir, ["push", "-q", "-u", "origin", "master"]);

	// Stub gh: prints a PR URL.
	stubGh = join(configDir, "stub-gh.sh");
	writeFileSync(stubGh, '#!/bin/sh\necho "https://git.example.com/pr/1"\n');
	chmodSync(stubGh, 0o755);

	// Stub fusion binary: headless mode makes a change + emits a stream-json
	// result line; worker mode re-execs the real handler via bun.
	const cliEntry = join(import.meta.dir, "..", "..", "src", "entrypoints", "cli.tsx");
	stubFusion = join(configDir, "stub-fusion.sh");
	writeFileSync(
		stubFusion,
		`#!/bin/sh
if [ "$1" = "task" ] && [ "$2" = "--worker" ]; then
    exec bun run "${cliEntry}" task --worker "$3"
fi
echo "stub change" > change.txt
echo '{"type":"result","num_turns":2,"total_cost_usd":0.01,"is_error":false,"result":"stub done","usage":{"input_tokens":10,"output_tokens":5}}'
`,
	);
	chmodSync(stubFusion, 0o755);

	process.env.FUSION_CODE_CONFIG_DIR = configDir;
	process.env.FUSION_CODE_TASK_FUSION_BIN = stubFusion;
	process.env.FUSION_CODE_TASK_GH_BIN = stubGh;
});

afterAll(() => {
	delete process.env.FUSION_CODE_CONFIG_DIR;
	delete process.env.FUSION_CODE_TASK_FUSION_BIN;
	delete process.env.FUSION_CODE_TASK_GH_BIN;
	// Restore cwd before deleting temp dirs: leaked chdir(repoDir) breaks
	// later suites whose config discovery depends on process.cwd().
	process.chdir(origCwd);
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("fusion-code task (P2.1)", () => {
	test(
		"start runs detached, completes, opens PR, writes summary",
		async () => {
			const { taskMain } = await import("../../src/cli/handlers/task.js");
			process.chdir(repoDir);
			await taskMain(["start", "add a stub change"]);
		const ids = await Bun.$`ls ${join(configDir, "tasks")}`.text();
		const id = ids.split("\n").find((f) => f.endsWith(".json"))!.slice(0, -5);
		const record = readRecord(id);
		expect(record.worktree).toContain(join("worktrees", id));
		expect(existsSync(record.worktree as string)).toBe(true);

		const status = await waitForStatus(id, ["completed", "failed"], 45000);
		expect(status).toBe("completed");
		const finished = readRecord(id);
		const result = finished.result as Record<string, unknown>;
		expect(result.files.join("\n")).toContain("change.txt");
		expect(result.prUrl).toBe("https://git.example.com/pr/1");
		expect(result.turns).toBe(2);
		expect(result.tokens).toBe(15);
		// Branch landed on origin.
		const pushed = git(originDir, ["rev-parse", "--verify", `refs/heads/${record.branch}`]);
		expect(pushed.ok).toBe(true);
		},
		60000,
	);

	test("task list shows the completed task", async () => {
		const { taskMain } = await import("../../src/cli/handlers/task.js");
		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(String(args[0]));
		};
		try {
			await taskMain(["list"]);
		} finally {
			console.log = originalLog;
		}
		const line = logs.find((l) => l.includes("completed"));
		expect(line).toBeTruthy();
		expect(line).toContain("https://git.example.com/pr/1");
	});

	test(
		"cancel kills the task and removes the worktree",
		async () => {
		// Slow stub: headless query sleeps so the task stays running.
		const cliEntry = join(import.meta.dir, "..", "..", "src", "entrypoints", "cli.tsx");
		const slowStub = join(configDir, "stub-fusion-slow.sh");
		writeFileSync(
			slowStub,
			`#!/bin/sh
if [ "$1" = "task" ] && [ "$2" = "--worker" ]; then
    exec bun run "${cliEntry}" task --worker "$3"
fi
sleep 60
`,
		);
		chmodSync(slowStub, 0o755);
		process.env.FUSION_CODE_TASK_FUSION_BIN = slowStub;
		const { taskMain } = await import("../../src/cli/handlers/task.js");
		process.chdir(repoDir);
		await taskMain(["start", "long running task"]);
		const ids = await Bun.$`ls ${join(configDir, "tasks")}`.text();
		const files = ids.split("\n").filter((f) => f.endsWith(".json"));
		const id = files[files.length - 1]!.slice(0, -5);
		// Wait until the worker process exists.
		await new Promise((r) => setTimeout(r, 1500));
		const record = readRecord(id);
		const worktree = record.worktree as string;
		expect(existsSync(worktree)).toBe(true);

		await taskMain(["cancel", id]);
		const after = readRecord(id);
		expect(after.status).toBe("cancelled");
		expect(existsSync(worktree)).toBe(false);
		// Branch deleted locally.
		const branchGone = git(repoDir, [
			"rev-parse",
			"--verify",
			`refs/heads/${record.branch}`,
		]);
		expect(branchGone.ok).toBe(false);
		},
		60000,
	);
});
