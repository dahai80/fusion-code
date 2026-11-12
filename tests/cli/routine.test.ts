import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Evolution plan P2.2: reviewer runs headless on a diff and produces a
// findings file; a routine fires on schedule and its record shows in the
// task store. Uses a stub fusion binary that emits findings JSON.

const tempDirs: string[] = [];
let repoDir = "";
let configDir = "";
let stubFusion = "";

const FINDINGS_JSON = JSON.stringify([
	{ file: "src/a.ts", line: 10, severity: "high", title: "unsafe cast", fix: "narrow the type" },
	{ file: "src/b.ts", line: null, severity: "low", title: "naming", fix: "rename" },
]);

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { ok: proc.status === 0, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

function readRoutine(id: string): Record<string, unknown> {
	return JSON.parse(
		readFileSync(join(configDir, "routines", `${id}.json`), "utf8"),
	) as Record<string, unknown>;
}

beforeAll(() => {
	configDir = mkdtempSync(join(tmpdir(), "fc-routine-cfg-"));
	tempDirs.push(configDir);
	repoDir = mkdtempSync(join(tmpdir(), "fc-routine-repo-"));
	tempDirs.push(repoDir);
	git(repoDir, ["init", "-q"]);
	git(repoDir, ["config", "user.email", "t@e.com"]);
	git(repoDir, ["config", "user.name", "T"]);
	writeFileSync(join(repoDir, "a.ts"), "const x: number = 1;\n");
	git(repoDir, ["add", "-A"]);
	git(repoDir, ["commit", "-q", "-m", "seed"]);
	// Working diff for the reviewer to chew on.
	writeFileSync(join(repoDir, "a.ts"), "const x: string = Number(1) as unknown as string;\n");

	stubFusion = join(configDir, "stub-fusion.sh");
	const resultJson = JSON.stringify({
		type: "result",
		num_turns: 1,
		total_cost_usd: 0.0,
		is_error: false,
		result: `review done: \`\`\`json ${FINDINGS_JSON} \`\`\``,
		usage: { input_tokens: 10, output_tokens: 5 },
	});
	writeFileSync(
		stubFusion,
		`#!/bin/sh
cat > /dev/null
echo '${resultJson.replace(/'/g, `'\\''`)}'
`,
	);
	chmodSync(stubFusion, 0o755);
	process.env.FUSION_CODE_CONFIG_DIR = configDir;
	process.env.FUSION_CODE_TASK_FUSION_BIN = stubFusion;
});

afterAll(() => {
	delete process.env.FUSION_CODE_CONFIG_DIR;
	delete process.env.FUSION_CODE_TASK_FUSION_BIN;
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("reviewer (P2.2)", () => {
	test("runs headless on a diff and produces a findings file", async () => {
		const { runReviewer } = await import(
			"../../src/services/review/reviewer.js"
		);
		const run = await runReviewer({ preset: "review", cwd: repoDir });
		expect(run.error).toBeNull();
		expect(run.findings).toHaveLength(2);
		expect(run.findings[0]!.file).toBe("src/a.ts");
		expect(run.findings[0]!.severity).toBe("high");
		expect(run.findings[1]!.line).toBeNull();
		expect(existsSync(run.findingsPath)).toBe(true);
		const persisted = JSON.parse(readFileSync(run.findingsPath, "utf8")) as {
			findings: unknown[];
		};
		expect(persisted.findings).toHaveLength(2);
	});

	test("unknown preset throws; no diff throws", async () => {
		const { runReviewer } = await import(
			"../../src/services/review/reviewer.js"
		);
		await expect(
			runReviewer({ preset: "nope", cwd: repoDir }),
		).rejects.toThrow("unknown reviewer preset");
		const empty = mkdtempSync(join(tmpdir(), "fc-routine-empty-"));
		tempDirs.push(empty);
		git(empty, ["init", "-q"]);
		git(empty, ["config", "user.email", "t@e.com"]);
		git(empty, ["config", "user.name", "T"]);
		writeFileSync(join(empty, "s.txt"), "s\n");
		git(empty, ["add", "-A"]);
		git(empty, ["commit", "-q", "-m", "seed"]);
		await expect(runReviewer({ preset: "review", cwd: empty })).rejects.toThrow(
			"no working diff",
		);
	});
});

describe("routine (P2.2)", () => {
	test("add validates cron + preset, list shows it", async () => {
		const { routineMain } = await import("../../src/cli/handlers/routine.js");
		const logs: string[] = [];
		const errors: string[] = [];
		const originalLog = console.log;
		const originalError = console.error;
		console.log = (...a: unknown[]) => logs.push(String(a[0]));
		console.error = (...a: unknown[]) => errors.push(String(a[0]));
		try {
			await routineMain([
				"add",
				"--cron",
				"not-a-cron",
				"--preset",
				"review",
				"--repo",
				repoDir,
			]);
			expect(errors.some((e) => e.includes("invalid cron"))).toBe(true);

			await routineMain([
				"add",
				"--cron",
				"0 9 * * *",
				"--preset",
				"bogus",
				"--repo",
				repoDir,
			]);
			expect(errors.some((e) => e.includes("unknown preset"))).toBe(true);

			await routineMain([
				"add",
				"--cron",
				"0 9 * * *",
				"--preset",
				"security-review",
				"--repo",
				repoDir,
			]);
			const idFiles = readdirSync(join(configDir, "routines"));
			expect(idFiles).toHaveLength(1);
			const id = idFiles[0]!.slice(0, -5);
			const record = readRoutine(id);
			expect(record.preset).toBe("security-review");
			expect(record.nextFireAt).toBeTruthy();

			await routineMain(["list"]);
			expect(logs.some((l) => l.includes("security-review"))).toBe(true);
		} finally {
			console.log = originalLog;
			console.error = originalError;
		}
	});

	test("due fires the routine and lands a record in the task store", async () => {
		const { routineMain } = await import("../../src/cli/handlers/routine.js");
		const idFile = readdirSync(join(configDir, "routines"))[0]!;
		const id = idFile.slice(0, -5);
		// Force due: backdate nextFireAt.
		const record = readRoutine(id);
		record.nextFireAt = new Date(Date.now() - 60_000).toISOString();
		writeFileSync(
			join(configDir, "routines", idFile),
			JSON.stringify(record, null, 4),
		);

		const logs: string[] = [];
		const originalLog = console.log;
		console.log = (...a: unknown[]) => logs.push(String(a[0]));
		try {
			await routineMain(["due"]);
		} finally {
			console.log = originalLog;
		}
		expect(logs.some((l) => l.includes("firing routine"))).toBe(true);
		// Task-store record exists with routine prompt.
		const taskFiles = readdirSync(join(configDir, "tasks")).filter((f) =>
			f.endsWith(".json"),
		);
		expect(taskFiles.length).toBeGreaterThanOrEqual(1);
		const taskRecord = JSON.parse(
			readFileSync(join(configDir, "tasks", taskFiles[0]!), "utf8"),
		) as Record<string, unknown>;
		expect(String(taskRecord.prompt)).toContain(`routine security-review (${id})`);
		expect(taskRecord.status).toBe("completed");
		// Routine advanced its schedule.
		const updated = readRoutine(id);
		expect(updated.lastFiredAt).toBeTruthy();
		expect(String(updated.nextFireAt ?? "") > String(record.nextFireAt)).toBe(true);
	}, 30000);
});
