import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Evolution plan P2.1: detach-from-terminal background sessions.
//   fusion-code task start <prompt>   — daemonized headless session in its own
//                                       worktree (<configDir>/worktrees/<id>),
//                                       own log, survives terminal exit
//   fusion-code task list             — status from a fresh shell
//   fusion-code task logs <id>        — print the task log
//   fusion-code task attach <id>      — follow the log until the task ends
//   fusion-code task cancel <id>      — kill the task, remove the worktree
// Completion: commit the worktree, push the branch, open a PR via gh
// (FUSION_CODE_TASK_GH_BIN override mirrors the web server), and write a
// structured result summary (turns, tokens, cost, files, PR URL) into the
// task record. No new outbound network — tasks run against the already
// configured FUSION_BASE_URL.

type TaskStatus = "running" | "completed" | "failed" | "cancelled";

type TaskRecord = {
	id: string;
	prompt: string;
	cwd: string;
	worktree: string;
	branch: string;
	pid: number | null;
	status: TaskStatus;
	startedAt: string;
	finishedAt: string | null;
	result: TaskResult | null;
};

type TaskResult = {
	turns: number | null;
	tokens: number | null;
	costUsd: number | null;
	isError: boolean;
	resultText: string;
	files: string[];
	prUrl: string | null;
	error: string | null;
};

const TASKS_DIR = join(getConfigDir(), "tasks");
const WORKTREES_DIR = join(getConfigDir(), "worktrees");

function getConfigDir(): string {
	return process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
}

function logInfo(message: string): void {
	console.log(`[task] ${message}`);
}

function logError(message: string): void {
	console.error(`[task] ${message}`);
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { ok: proc.status === 0, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

function ghBin(): string {
	return process.env.FUSION_CODE_TASK_GH_BIN ?? "gh";
}

// Binary resolution: running from source (bun run cli.tsx) re-execs through
// bun; a compiled binary re-execs itself. Tests can inject a stub via
// FUSION_CODE_TASK_FUSION_BIN (single argv[0], receives remaining args).
function fusionCommand(extra: string[]): string[] {
	const stub = process.env.FUSION_CODE_TASK_FUSION_BIN;
	if (stub) return [stub, ...extra];
	const script = process.argv[1] ?? "";
	if (script.endsWith(".tsx") || script.endsWith(".ts")) {
		return [process.execPath, "run", script, ...extra];
	}
	return [process.execPath, ...extra];
}

function isProcessAlive(pid: number | null): boolean {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function recordPath(id: string): string {
	return join(TASKS_DIR, `${id}.json`);
}

function logPath(id: string): string {
	return join(TASKS_DIR, `${id}.log`);
}

function readRecord(id: string): TaskRecord | null {
	try {
		return JSON.parse(readFileSync(recordPath(id), "utf8")) as TaskRecord;
	} catch {
		return null;
	}
}

function writeRecord(record: TaskRecord): void {
	writeFileSync(recordPath(record.id), JSON.stringify(record, null, 4));
}

function listRecordIds(): string[] {
	if (!existsSync(TASKS_DIR)) return [];
	return readdirSync(TASKS_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.slice(0, -5));
}

// ── start ────────────────────────────────────────────────────────────────

function cmdStart(promptParts: string[]): number {
	const prompt = promptParts.join(" ").trim();
	if (!prompt) {
		logError("usage: fusion-code task start <prompt>");
		return 1;
	}
	const cwd = process.cwd();
	if (!git(cwd, ["rev-parse", "--git-dir"]).ok) {
		logError(`not a git repository: ${cwd}`);
		return 1;
	}
	const id = randomUUID().slice(0, 8);
	const worktree = join(WORKTREES_DIR, id);
	const branch = `fusion-task/${id}`;
	mkdirSync(WORKTREES_DIR, { recursive: true });
	mkdirSync(TASKS_DIR, { recursive: true });
	const add = git(cwd, ["worktree", "add", worktree, "-b", branch]);
	if (!add.ok) {
		logError(`worktree add failed: ${add.out.trim()}`);
		return 1;
	}
	const record: TaskRecord = {
		id,
		prompt,
		cwd,
		worktree,
		branch,
		pid: null,
		status: "running",
		startedAt: new Date().toISOString(),
		finishedAt: null,
		result: null,
	};
	writeRecord(record);
	// Detached worker: own process group, log file as stdout/stderr, survives
	// terminal exit. The worker re-execs fusion-code in worker mode.
	const logFd = openSync(logPath(id), "a");
	const workerCmd = workerSpawnArgs(id);
	const child = spawn(workerCmd[0]!, workerCmd.slice(1), {
		detached: true,
		stdio: ["ignore", logFd, logFd],
	});
	child.unref();
	record.pid = child.pid;
	writeRecord(record);
	logInfo(`task ${id} started (pid ${child.pid})`);
	logInfo(`worktree: ${worktree}`);
	logInfo(`branch:   ${branch}`);
	logInfo(`log:      fusion-code task logs ${id}`);
	return 0;
}

function workerSpawnArgs(id: string): string[] {
	const stub = process.env.FUSION_CODE_TASK_FUSION_BIN;
	if (stub) return [stub, "task", "--worker", id];
	const script = process.argv[1] ?? "";
	if (script.endsWith(".tsx") || script.endsWith(".ts")) {
		return [process.execPath, "run", script, "task", "--worker", id];
	}
	return [process.execPath, "task", "--worker", id];
}

// ── worker (hidden) ──────────────────────────────────────────────────────

async function runWorker(id: string): Promise<number> {
	const record = readRecord(id);
	if (!record) {
		logError(`worker: task record ${id} not found`);
		return 1;
	}
	let result: TaskResult;
	try {
		result = await runHeadlessQuery(record);
	} catch (error) {
		result = {
			turns: null,
			tokens: null,
			costUsd: null,
			isError: true,
			resultText: "",
			files: [],
			prUrl: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	// PR hand-back: only when the query produced changes.
	if (!result.isError && result.files.length > 0) {
		result.prUrl = createTaskPullRequest(record, result);
	}
	record.status = result.isError && !result.prUrl ? "failed" : "completed";
	if (result.isError && !result.files.length && !result.prUrl) {
		record.status = "failed";
	}
	record.finishedAt = new Date().toISOString();
	record.result = result;
	writeRecord(record);
	logInfo(
		`task ${id} ${record.status}${result.prUrl ? `: ${result.prUrl}` : ""}`,
	);
	return 0;
}

async function runHeadlessQuery(record: TaskRecord): Promise<TaskResult> {
	const proc = Bun.spawn(fusionCommand([
		"-p",
		record.prompt,
		"--output-format",
		"stream-json",
		"--verbose",
	]), {
		cwd: record.worktree,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FUSION_CODE_TASK_FUSION_BIN: "" },
	});
	const [exitCode, stdout] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
	]);
	// Keep the stream transcript in the log for debugging.
	appendFileSync(logPath(record.id), stdout);
	let resultEvent: Record<string, unknown> | null = null;
	for (const line of stdout.split("\n")) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed.type === "result") resultEvent = parsed;
		} catch {
			// non-JSON noise in the stream — skip
		}
	}
	const usage = (resultEvent?.usage ?? {}) as Record<string, number>;
	const totalTokens =
		(typeof usage.input_tokens === "number" ? usage.input_tokens : 0) +
		(typeof usage.output_tokens === "number" ? usage.output_tokens : 0);
	const files = git(record.worktree, ["status", "--porcelain"]);
	const isError = exitCode !== 0 || resultEvent === null ||
		resultEvent.is_error === true;
	return {
		turns:
			typeof resultEvent?.num_turns === "number" ? resultEvent.num_turns : null,
		tokens: totalTokens > 0 ? totalTokens : null,
		costUsd:
			typeof resultEvent?.total_cost_usd === "number"
				? resultEvent.total_cost_usd
				: null,
		isError,
		resultText:
			typeof resultEvent?.result === "string" ? resultEvent.result : "",
		files: files.ok
			? files.out.split("\n").map((l) => l.trim()).filter(Boolean)
			: [],
		prUrl: null,
		error: isError
			? `headless run exited ${exitCode}${resultEvent ? " with is_error" : " without a result event"}`
			: null,
	};
}

// Commit + push + gh pr create (same semantics as web/server/gitRepo.ts
// createPullRequest — web is a separate package, src cannot import it).
function createTaskPullRequest(
	record: TaskRecord,
	result: TaskResult,
): string | null {
	const wt = record.worktree;
	const add = git(wt, ["add", "-A"]);
	if (!add.ok) {
		result.error = `git add failed: ${add.out.trim()}`;
		return null;
	}
	const staged = git(wt, ["diff", "--cached", "--quiet"]);
	if (staged.ok) {
		// Nothing to commit — not a failure, just no PR.
		return null;
	}
	const title = `task: ${record.prompt.slice(0, 60)}`;
	const body = [
		`Background task ${record.id} (fusion-code task start).`,
		"",
		"Structured result summary:",
		`- turns: ${result.turns ?? "n/a"}`,
		`- tokens: ${result.tokens ?? "n/a"}`,
		`- cost: ${result.costUsd ?? "n/a"}`,
		`- files: ${result.files.length}`,
		"",
		"🤖 Generated with [Claude Code](https://claude.com/claude-code)",
	].join("\n");
	const commit = git(wt, ["commit", "-m", title]);
	if (!commit.ok) {
		result.error = `git commit failed: ${commit.out.trim()}`;
		return null;
	}
	const push = git(wt, ["push", "-u", "origin", record.branch]);
	if (!push.ok) {
		result.error = `git push failed: ${push.out.trim()}`;
		return null;
	}
	const proc = spawnSync(
		ghBin(),
		["pr", "create", "--title", title, "--body", body],
		{ cwd: wt, encoding: "utf8" },
	);
	const url = `${proc.stdout ?? ""}`.trim().split("\n").pop() ?? "";
	if (proc.status !== 0 || !url.startsWith("http")) {
		result.error = `gh pr create failed: ${`${proc.stderr ?? ""}`.trim().slice(0, 400)}`;
		return null;
	}
	return url;
}

// ── list / logs / attach / cancel ────────────────────────────────────────

function cmdList(): number {
	const ids = listRecordIds().sort();
	if (ids.length === 0) {
		logInfo("no tasks");
		return 0;
	}
	for (const id of ids) {
		const record = readRecord(id);
		if (!record) continue;
		let status: string = record.status;
		if (status === "running" && !isProcessAlive(record.pid)) {
			status = "lost";
		}
		const pr = record.result?.prUrl ?? "-";
		const prompt = record.prompt.length > 50
			? `${record.prompt.slice(0, 50)}…`
			: record.prompt;
		logInfo(
			`${record.id}  ${status.padEnd(10)}  pr=${pr}  ${prompt}`,
		);
	}
	return 0;
}

function cmdLogs(id: string): number {
	const file = logPath(id);
	if (!existsSync(file)) {
		logError(`no log for task ${id}`);
		return 1;
	}
	process.stdout.write(readFileSync(file, "utf8"));
	return 0;
}

async function cmdAttach(id: string): Promise<number> {
	const file = logPath(id);
	if (!existsSync(file)) {
		logError(`no log for task ${id}`);
		return 1;
	}
	let offset = 0;
	for (;;) {
		const record = readRecord(id);
		if (!record) {
			logError(`task ${id} not found`);
			return 1;
		}
		const size = existsSync(file) ? readFileSync(file).byteLength : 0;
		if (size > offset) {
			const buf = Buffer.alloc(size - offset);
			const fd = openSync(file, "r");
			readSync(fd, buf, 0, size - offset, offset);
			closeSync(fd);
			process.stdout.write(buf);
			offset = size;
		}
		if (record.status !== "running") {
			logInfo(`task ${id} ${record.status}`);
			return 0;
		}
		await Bun.sleep(500);
	}
}

function cmdCancel(id: string): number {
	const record = readRecord(id);
	if (!record) {
		logError(`task ${id} not found`);
		return 1;
	}
	if (record.status === "running") {
		if (isProcessAlive(record.pid)) {
			try {
				process.kill(record.pid!, "SIGTERM");
			} catch {
				// already gone
			}
		}
	} else {
		logInfo(`task ${id} already ${record.status}`);
	}
	// Clean worktree removal + branch delete.
	const remove = git(record.cwd, ["worktree", "remove", "--force", record.worktree]);
	if (!remove.ok) {
		rmSync(record.worktree, { recursive: true, force: true });
	}
	git(record.cwd, ["branch", "-D", record.branch]);
	record.status = "cancelled";
	record.finishedAt = new Date().toISOString();
	writeRecord(record);
	logInfo(`task ${id} cancelled (worktree removed)`);
	return 0;
}

// ── entry ────────────────────────────────────────────────────────────────

export async function taskMain(args: string[]): Promise<void> {
	const sub = args[0];
	if (sub === "--worker" && args[1]) {
		process.exitCode = await runWorker(args[1]);
		return;
	}
	if (sub === "start") {
		process.exitCode = cmdStart(args.slice(1));
		return;
	}
	if (sub === "list") {
		process.exitCode = cmdList();
		return;
	}
	if (sub === "logs" && args[1]) {
		process.exitCode = cmdLogs(args[1]);
		return;
	}
	if (sub === "attach" && args[1]) {
		process.exitCode = await cmdAttach(args[1]);
		return;
	}
	if (sub === "cancel" && args[1]) {
		process.exitCode = cmdCancel(args[1]);
		return;
	}
	logError(
		"usage: fusion-code task start <prompt> | list | logs <id> | attach <id> | cancel <id>",
	);
	process.exitCode = 1;
}
