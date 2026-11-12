import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

// Evolution plan P2.4 — spec-driven development gate (C7). Minimal honest
// version, brownfield-friendly (OpenSpec's angle): flat requirement +
// invariant files under specs/<capability>/, delta-first, no heavyweight
// templates. The implement gate is code-enforced in the turn boundary:
// `spec implement` refuses to start a kernel turn for a task item that is
// not approved (unchecked) in tasks.md — not prompt discipline.
//
// Subcommands:
//   spec new <capability>                 scaffold specs/<cap>/spec.md
//   spec plan <capability>                scaffold specs/<cap>/plan.md
//   spec tasks <capability>               scaffold specs/<cap>/tasks.md
//   spec import <source> [--capability N] read-only Spec Kit / OpenSpec import
//   spec list                             list capabilities + task state
//   spec implement <capability> --task ID gate + headless implement turn

type SpecTask = {
	checked: boolean;
	id: string;
	text: string;
	done: boolean;
};

const SPEC_DIR = "specs";

function logInfo(message: string): void {
	console.log(`[spec] ${message}`);
}

function logError(message: string): void {
	console.error(`[spec] ${message}`);
}

function specDir(capability: string): string {
	return join(process.cwd(), SPEC_DIR, capability);
}

function readText(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

// Tasks.md line grammar: `- [ ] <id> <text>` (pending) / `- [x] <id> <text>`
// (approved) / `- [x] <id> <text> [implemented <iso>]` (approved + done).
const TASK_RE = /^- \[( |x)\] (\S+) (.*?)( \[implemented \d{4}-\d{2}-\d{2}T.*\])?$/;

function parseTasks(tasksMd: string): SpecTask[] {
	const tasks: SpecTask[] = [];
	for (const line of tasksMd.split("\n")) {
		const m = TASK_RE.exec(line.trim());
		if (!m || !m[2] || !m[3]) continue;
		tasks.push({
			checked: m[1] === "x",
			id: m[2],
			text: m[3],
			done: Boolean(m[4]),
		});
	}
	return tasks;
}

// ── new / plan / tasks ───────────────────────────────────────────────────

function cmdNew(capability: string): number {
	if (!capability || /[\\/]/.test(capability)) {
		logError("usage: fusion-code spec new <capability>");
		return 1;
	}
	const dir = specDir(capability);
	const specPath = join(dir, "spec.md");
	if (existsSync(specPath)) {
		logError(`already exists: ${specPath}`);
		return 1;
	}
	mkdirSync(dir, { recursive: true });
	// Delta-first (OpenSpec style): changes are expressed as deltas against
	// current behavior; invariants are the always-true conditions.
	writeFileSync(
		specPath,
		[
			`# ${capability} — specification (delta-first)`,
			"",
			"## ADDED Requirements",
			"",
			"### Requirement: <requirement name>",
			"<one-line behavior the system must provide>",
			"",
			"#### Scenario: <scenario name>",
			"- WHEN <trigger>",
			"- THEN <observable outcome>",
			"",
			"## Invariants",
			"",
			"- INV-1: <condition that must always hold>",
			"",
		].join("\n"),
	);
	logInfo(`created ${specPath}`);
	logInfo(`next: fusion-code spec plan ${capability}`);
	return 0;
}

function cmdPlan(capability: string): number {
	const dir = specDir(capability);
	if (!existsSync(join(dir, "spec.md"))) {
		logError(`no spec for ${capability} — run: fusion-code spec new ${capability}`);
		return 1;
	}
	const planPath = join(dir, "plan.md");
	if (existsSync(planPath)) {
		logError(`already exists: ${planPath}`);
		return 1;
	}
	writeFileSync(
		planPath,
		[
			`# ${capability} — technical plan`,
			"",
			"## Context",
			"<files/modules this delta touches>",
			"",
			"## Approach",
			"<minimal change that satisfies the spec deltas + invariants>",
			"",
			"## Risks",
			"<what could break>",
			"",
		].join("\n"),
	);
	logInfo(`created ${planPath}`);
	logInfo(`next: fusion-code spec tasks ${capability}`);
	return 0;
}

function cmdTasks(capability: string): number {
	const dir = specDir(capability);
	if (!existsSync(join(dir, "plan.md"))) {
		logError(`no plan for ${capability} — run: fusion-code spec plan ${capability}`);
		return 1;
	}
	const tasksPath = join(dir, "tasks.md");
	if (existsSync(tasksPath)) {
		logError(`already exists: ${tasksPath}`);
		return 1;
	}
	writeFileSync(
		tasksPath,
		[
			`# ${capability} — tasks`,
			"",
			"<!-- Approve a task by checking its box; spec implement refuses",
			"     unchecked items (turn-boundary gate, not prompt discipline). -->",
			"",
			"- [ ] 1.1 <first task>",
			"",
		].join("\n"),
	);
	logInfo(`created ${tasksPath}`);
	logInfo(
		`next: check off an approved item, then fusion-code spec implement ${capability} --task 1.1`,
	);
	return 0;
}

// ── import (read-only compat: Spec Kit / OpenSpec, not lock-in) ──────────

function detectSpecFormat(md: string): "openspec" | "speckit" | "generic" {
	if (/^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements/m.test(md)) return "openspec";
	if (/^##\s+User Stories/m.test(md) || /CONSTITUTION/i.test(md)) return "speckit";
	return "generic";
}

function cmdImport(source: string, capability: string | null): number {
	const src = resolve(source);
	const md =
		readText(src) ??
		(statIsDir(src) ? readText(join(src, "spec.md")) : null);
	if (md === null) {
		logError(`no spec.md found at ${src} (pass a spec.md or its directory)`);
		return 1;
	}
	const derived = src.endsWith("spec.md")
		? (src.split("/").at(-2) ?? null)
		: src.split("/").at(-1) ?? null;
	const cap = capability ?? derived;
	if (!cap || /[\\/]/.test(cap)) {
		logError("could not derive capability name — pass --capability <name>");
		return 1;
	}
	const format = detectSpecFormat(md);
	const dir = specDir(cap);
	if (existsSync(join(dir, "spec.md"))) {
		logError(`already exists: ${join(dir, "spec.md")} — import never overwrites`);
		return 1;
	}
	mkdirSync(dir, { recursive: true });
	// Read-only import: the source file is never touched; a provenance
	// comment records origin + format so deltas can be fixed up by hand.
	writeFileSync(
		join(dir, "spec.md"),
		`<!-- imported read-only from ${src} (format: ${format}) -->\n\n${md}`,
	);
	logInfo(`imported ${format} spec into ${join(dir, "spec.md")} (source untouched)`);
	return 0;
}

function statIsDir(path: string): boolean {
	try {
		return readdirSync(path).length >= 0;
	} catch {
		return false;
	}
}

// ── list ─────────────────────────────────────────────────────────────────

function cmdList(): number {
	const root = join(process.cwd(), SPEC_DIR);
	if (!existsSync(root)) {
		logInfo("no specs/ directory in this repo");
		return 0;
	}
	const caps = readdirSync(root, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	for (const cap of caps) {
		const has = (f: string) => (existsSync(join(root, cap, f)) ? "y" : "-");
		const tasks = parseTasks(readText(join(root, cap, "tasks.md")) ?? "");
		const approved = tasks.filter((t) => t.checked).length;
		logInfo(
			`${cap}  spec:${has("spec.md")} plan:${has("plan.md")} tasks:${has("tasks.md")}  approved:${approved}/${tasks.length}`,
		);
	}
	return 0;
}

// ── implement (the gate) ─────────────────────────────────────────────────

// Kernel invocation. FUSION_CODE_TASK_FUSION_BIN replaces it wholesale
// (same test seam as task.ts) so tests run the cycle without a model.
function implementArgv(prompt: string): string[] {
	const stub = process.env.FUSION_CODE_TASK_FUSION_BIN;
	if (stub) return [stub, prompt];
	return [
		process.execPath,
		"-p",
		prompt,
		"--output-format",
		"stream-json",
		"--verbose",
	];
}

async function cmdImplement(capability: string, taskId: string | null): Promise<number> {
	const dir = specDir(capability);
	const specMd = readText(join(dir, "spec.md"));
	const planMd = readText(join(dir, "plan.md"));
	const tasksPath = join(dir, "tasks.md");
	const tasksMd = readText(tasksPath);
	if (!specMd || !planMd || !tasksMd) {
		logError(
			`incomplete spec for ${capability} — need spec.md + plan.md + tasks.md under ${dir}`,
		);
		return 1;
	}
	const tasks = parseTasks(tasksMd);
	if (tasks.length === 0) {
		logError(`no task items in ${tasksPath}`);
		return 1;
	}
	// ── TURN-BOUNDARY GATE (code-enforced, not prompt discipline) ──
	// A kernel turn that touches code may only start for an APPROVED
	// (checked-off) task item. Unknown or unchecked ids never reach the model.
	const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
	if (!task) {
		logError(`GATE: task '${taskId ?? "<none>"}' not found in tasks.md`);
		logError(
			`available: ${tasks.map((t) => `${t.id}${t.checked ? "" : " (unapproved)"}`).join(", ")}`,
		);
		return 1;
	}
	if (!task.checked) {
		logError(
			`GATE: task ${task.id} is NOT approved — refusing to start an implement turn.`,
		);
		logError(`Approve it first by checking the box in ${tasksPath}:`);
		logError(`  - [x] ${task.id} ${task.text}`);
		return 1;
	}
	if (task.done) {
		logError(`GATE: task ${task.id} already implemented.`);
		return 1;
	}

	const prompt = [
		`Implement exactly this approved task from the spec "${capability}".`,
		`Task ${task.id}: ${task.text}`,
		"",
		"## Specification (delta-first)",
		specMd.trim(),
		"",
		"## Technical plan",
		planMd.trim(),
		"",
		"Respect every invariant. Change only what this task requires.",
	].join("\n");

	logInfo(`gate passed — starting implement turn for ${capability}/${task.id}`);
	const proc = Bun.spawn(implementArgv(prompt), {
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FUSION_CODE_TASK_FUSION_BIN: "" },
	});
	const [exitCode, out] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
	]);
	let resultText = "";
	let isError = exitCode !== 0;
	for (const line of out.split("\n")) {
		if (!line.trim().startsWith("{")) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed.type === "result") {
				resultText = typeof parsed.result === "string" ? parsed.result : "";
				if (parsed.is_error === true) isError = true;
			}
		} catch {
			// non-JSON noise — skip
		}
	}
	if (isError) {
		logError(
			`implement turn failed (exit ${exitCode})${resultText ? `: ${resultText.slice(0, 300)}` : ""}`,
		);
		logError("task left approved-but-not-done; fix and re-run the same command");
		return 1;
	}
	// Mark the item done in tasks.md (approved -> implemented).
	const stamp = `[implemented ${new Date().toISOString()}]`;
	const updated = tasksMd
		.split("\n")
		.map((l) =>
			l.trim().startsWith(`- [x] ${task.id} `) && !l.includes("[implemented")
				? `${l} ${stamp}`
				: l,
		)
		.join("\n");
	writeFileSync(tasksPath, updated);
	logInfo(`task ${task.id} implemented${resultText ? `: ${resultText.slice(0, 200)}` : ""}`);
	return 0;
}

// ── dispatch ─────────────────────────────────────────────────────────────

export async function specMain(args: string[]): Promise<number> {
	const [sub, ...rest] = args;
	const capability = rest[0] ?? null;
	let code = 1;
	if (sub === "new" && capability) {
		code = cmdNew(capability);
	} else if (sub === "plan" && capability) {
		code = cmdPlan(capability);
	} else if (sub === "tasks" && capability) {
		code = cmdTasks(capability);
	} else if (sub === "import" && capability) {
		const capIdx = rest.indexOf("--capability");
		const cap = capIdx >= 0 ? (rest[capIdx + 1] ?? null) : null;
		code = cmdImport(capability, cap);
	} else if (sub === "list") {
		code = cmdList();
	} else if (sub === "implement" && capability) {
		const taskIdx = rest.indexOf("--task");
		const taskId = taskIdx >= 0 ? (rest[taskIdx + 1] ?? null) : null;
		code = await cmdImplement(capability, taskId);
	} else {
		logError("usage: fusion-code spec new|plan|tasks|import|list|implement ...");
	}
	return code;
}
