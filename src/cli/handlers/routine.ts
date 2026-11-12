import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseCronExpression } from "../../utils/cron.js";
import { nextCronRunMs } from "../../utils/cronTasks.js";
import {
	isReviewerPreset,
	runReviewer,
	type ReviewFinding,
} from "../../services/review/reviewer.js";

// Evolution plan P2.2: routines — cron-scheduled reviewer runs surfaced as a
// product command. Local-only scheduling: a routine record stores the cron
// expression; `fusion-code routine due` fires every due routine (drive it
// from a system crontab line — no daemon, no cloud dependency). Each fire
// runs the reviewer headless on the repo's working diff, writes a findings
// file, and records the run in the task store (visible in `task list`).
// Opt-in --issue files the findings as a GitHub issue (best-effort).

type RoutineRecord = {
	id: string;
	cron: string;
	preset: string;
	repo: string;
	issue: boolean;
	createdAt: string;
	lastFiredAt: string | null;
	nextFireAt: string | null;
};

function getConfigDir(): string {
	return process.env.FUSION_CODE_CONFIG_DIR ?? join(homedir(), ".fusion-code");
}

function routinesDir(): string {
	return join(getConfigDir(), "routines");
}

function routinePath(id: string): string {
	return join(routinesDir(), `${id}.json`);
}

function logInfo(message: string): void {
	console.log(`[routine] ${message}`);
}

function logError(message: string): void {
	console.error(`[routine] ${message}`);
}

function readRoutine(id: string): RoutineRecord | null {
	try {
		return JSON.parse(readFileSync(routinePath(id), "utf8")) as RoutineRecord;
	} catch {
		return null;
	}
}

function listRoutineIds(): string[] {
	if (!existsSync(routinesDir())) return [];
	return readdirSync(routinesDir())
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.slice(0, -5));
}

// ── add ──────────────────────────────────────────────────────────────────

function cmdAdd(args: string[]): number {
	let cron = "";
	let preset = "";
	let repo = process.cwd();
	let issue = false;
	for (let i = 0; i < args.length; i++) {
		const a = args[i]!;
		if (a === "--cron") cron = args[++i] ?? "";
		else if (a === "--preset") preset = args[++i] ?? "";
		else if (a === "--repo") repo = args[++i] ?? process.cwd();
		else if (a === "--issue") issue = true;
	}
	if (!cron || !preset) {
		logError(
			"usage: fusion-code routine add --cron <expr> --preset review|security-review|deps-audit [--repo <dir>] [--issue]",
		);
		return 1;
	}
	if (!parseCronExpression(cron)) {
		logError(`invalid cron expression: ${cron}`);
		return 1;
	}
	if (!isReviewerPreset(preset)) {
		logError(`unknown preset: ${preset} (known: review, security-review, deps-audit)`);
		return 1;
	}
	if (!existsSync(repo)) {
		logError(`repo directory not found: ${repo}`);
		return 1;
	}
	mkdirSync(routinesDir(), { recursive: true });
	const id = randomUUID().slice(0, 8);
	const record: RoutineRecord = {
		id,
		cron,
		preset,
		repo,
		issue,
		createdAt: new Date().toISOString(),
		lastFiredAt: null,
		nextFireAt: null,
	};
	updateNextFire(record);
	writeFileSync(routinePath(id), JSON.stringify(record, null, 4));
	logInfo(`routine ${id} added (${preset}, cron ${cron}, repo ${repo})`);
	logInfo("drive it locally, e.g.:  * * * * * fusion-code routine due");
	return 0;
}

function updateNextFire(record: RoutineRecord): void {
	const from = record.lastFiredAt
		? Date.parse(record.lastFiredAt)
		: Date.parse(record.createdAt);
	const next = nextCronRunMs(record.cron, from);
	record.nextFireAt = next ? new Date(next).toISOString() : null;
}

// ── list ─────────────────────────────────────────────────────────────────

function cmdList(): number {
	const ids = listRoutineIds();
	if (ids.length === 0) {
		logInfo("no routines");
		return 0;
	}
	for (const id of ids) {
		const record = readRoutine(id);
		if (!record) continue;
		logInfo(
			`${record.id}  ${record.preset.padEnd(16)}  cron=${record.cron}  next=${record.nextFireAt ?? "-"}  ${record.repo}${record.issue ? "  (--issue)" : ""}`,
		);
	}
	return 0;
}

// ── fire / due ───────────────────────────────────────────────────────────

async function fireRoutine(record: RoutineRecord): Promise<void> {
	logInfo(`firing routine ${record.id} (${record.preset}) on ${record.repo}`);
	let status: "completed" | "failed" = "completed";
	let summary = "";
	let prUrl: string | null = null;
	try {
		const run = await runReviewer({
			preset: record.preset,
			cwd: record.repo,
			withSecurityContext: true,
		});
		if (run.error) {
			status = "failed";
			summary = run.error;
		} else {
			summary = `${run.findings.length} finding(s) → ${run.findingsPath}`;
			if (record.issue && run.findings.length > 0) {
				await fileFindingsIssue(record, run.findings);
			}
		}
	} catch (error) {
		status = "failed";
		summary = error instanceof Error ? error.message : String(error);
	}
	// Task-store record — shows up in `fusion-code task list`.
	const taskId = randomUUID().slice(0, 8);
	mkdirSync(join(getConfigDir(), "tasks"), { recursive: true });
	writeFileSync(
		join(getConfigDir(), "tasks", `${taskId}.json`),
		JSON.stringify(
			{
				id: taskId,
				prompt: `routine ${record.preset} (${record.id})`,
				cwd: record.repo,
				worktree: "",
				branch: "",
				pid: null,
				status,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				result: {
					turns: null,
					tokens: null,
					costUsd: null,
					isError: status === "failed",
					resultText: summary,
					files: [],
					prUrl,
					error: status === "failed" ? summary : null,
				},
			},
			null,
			4,
		),
	);
	logInfo(`routine ${record.id} ${status}: ${summary}`);
}

async function fileFindingsIssue(
	record: RoutineRecord,
	findings: ReviewFinding[],
): Promise<void> {
	const gh = process.env.FUSION_CODE_TASK_GH_BIN ?? "gh";
	const body = findings
		.map((f) => `- **${f.severity}** ${f.file}:${f.line ?? "?"} — ${f.title}\n  fix: ${f.fix}`)
		.join("\n");
	const proc = Bun.spawnSync([gh, "issue", "create", "--title", `Routine review findings (${record.preset})`, "--body", body || "No findings."], {
		cwd: record.repo,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		logError(`gh issue create failed (best-effort, ignored)`);
	}
}

async function cmdFire(id: string): Promise<number> {
	const record = readRoutine(id);
	if (!record) {
		logError(`routine ${id} not found`);
		return 1;
	}
	await fireRoutine(record);
	record.lastFiredAt = new Date().toISOString();
	updateNextFire(record);
	writeFileSync(routinePath(record.id), JSON.stringify(record, null, 4));
	return 0;
}

async function cmdDue(): Promise<number> {
	const now = Date.now();
	const due = listRoutineIds()
		.map((id) => readRoutine(id))
		.filter((r): r is RoutineRecord => r !== null)
		.filter((r) => r.nextFireAt && Date.parse(r.nextFireAt) <= now);
	if (due.length === 0) {
		logInfo("no routines due");
		return 0;
	}
	for (const record of due) {
		await fireRoutine(record);
		record.lastFiredAt = new Date().toISOString();
		updateNextFire(record);
		writeFileSync(routinePath(record.id), JSON.stringify(record, null, 4));
	}
	return 0;
}

// ── entry ────────────────────────────────────────────────────────────────

export async function routineMain(args: string[]): Promise<void> {
	const sub = args[0];
	if (sub === "add") {
		process.exitCode = cmdAdd(args.slice(1));
		return;
	}
	if (sub === "list") {
		process.exitCode = cmdList();
		return;
	}
	if (sub === "due") {
		process.exitCode = await cmdDue();
		return;
	}
	if (sub === "fire" && args[1]) {
		process.exitCode = await cmdFire(args[1]);
		return;
	}
	logError("usage: fusion-code routine add --cron <expr> --preset <name> | list | due | fire <id>");
	process.exitCode = 1;
}
