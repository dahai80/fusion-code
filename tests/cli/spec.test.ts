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
import { specMain } from "../../src/cli/handlers/spec";

// Evolution plan P2.4: spec-driven development gate. Spec -> plan -> tasks
// -> implement cycle runs in-repo; the implement gate visibly blocks an
// ungated (unchecked) task before any kernel turn starts. Stub fusion bin
// proves the turn only fires for approved items.

const origCwd = process.cwd();
const tempDirs: string[] = [];
let repoDir = "";
let stubFusion = "";
let stubMarker = "";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
	return { ok: proc.status === 0, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

beforeAll(() => {
	repoDir = mkdtempSync(join(tmpdir(), "fc-spec-repo-"));
	tempDirs.push(repoDir);
	git(repoDir, ["init", "-q"]);
	git(repoDir, ["config", "user.email", "t@e.com"]);
	git(repoDir, ["config", "user.name", "T"]);
	writeFileSync(join(repoDir, "a.ts"), "const x = 1;\n");
	git(repoDir, ["add", "-A"]);
	git(repoDir, ["commit", "-q", "-m", "seed"]);

	// Stub fusion binary: records that a turn fired, emits a result event.
	stubMarker = join(repoDir, ".stub-turn-fired");
	stubFusion = join(repoDir, "stub-fusion.sh");
	writeFileSync(
		stubFusion,
		`#!/bin/sh\ntouch ${stubMarker}\necho '{"type":"result","num_turns":1,"total_cost_usd":0,"is_error":false,"result":"spec implement ok"}'\n`,
	);
	chmodSync(stubFusion, 0o755);

	process.chdir(repoDir);
	process.env.FUSION_CODE_TASK_FUSION_BIN = stubFusion;
});

afterAll(() => {
	delete process.env.FUSION_CODE_TASK_FUSION_BIN;
	// Restore original cwd before deleting temp dirs: leaked chdir(repoDir)
	// breaks later suites whose config discovery depends on process.cwd().
	process.chdir(origCwd);
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("spec SDD gate (P2.4)", () => {
	test("scaffold cycle: new -> plan -> tasks with validation", async () => {
		expect(await specMain(["plan", "cap-x"])).toBe(1);
		expect(await specMain(["new", "cap-x"])).toBe(0);
		expect(await specMain(["new", "cap-x"])).toBe(1);
		expect(await specMain(["tasks", "cap-x"])).toBe(1);
		expect(await specMain(["plan", "cap-x"])).toBe(0);
		expect(await specMain(["tasks", "cap-x"])).toBe(0);

		const spec = readFileSync(join(repoDir, "specs", "cap-x", "spec.md"), "utf8");
		expect(spec).toContain("## ADDED Requirements");
		expect(spec).toContain("## Invariants");
		const tasks = readFileSync(join(repoDir, "specs", "cap-x", "tasks.md"), "utf8");
		expect(tasks).toContain("- [ ] 1.1");
	});

	test("gate blocks implement for an unapproved task — no turn starts", async () => {
		const code = await specMain(["implement", "cap-x", "--task", "1.1"]);
		expect(code).toBe(1);
		expect(existsSync(stubMarker)).toBe(false);
		const tasks = readFileSync(join(repoDir, "specs", "cap-x", "tasks.md"), "utf8");
		expect(tasks).not.toContain("[implemented");
	});

	test("gate blocks unknown task ids too", async () => {
		expect(await specMain(["implement", "cap-x", "--task", "9.9"])).toBe(1);
		expect(existsSync(stubMarker)).toBe(false);
	});

	test("approved task passes the gate and the turn runs + stamps done", async () => {
		const tasksPath = join(repoDir, "specs", "cap-x", "tasks.md");
		writeFileSync(
			tasksPath,
			readFileSync(tasksPath, "utf8").replace("- [ ] 1.1", "- [x] 1.1"),
		);
		const code = await specMain(["implement", "cap-x", "--task", "1.1"]);
		expect(code).toBe(0);
		expect(existsSync(stubMarker)).toBe(true);
		const tasks = readFileSync(tasksPath, "utf8");
		expect(tasks).toMatch(/- \[x\] 1\.1 .* \[implemented \d{4}-\d{2}-\d{2}T/);
	});

	test("re-implementing a done task is refused", async () => {
		expect(await specMain(["implement", "cap-x", "--task", "1.1"])).toBe(1);
	});

	test("import is read-only and detects OpenSpec format", async () => {
		const srcDir = mkdtempSync(join(tmpdir(), "fc-spec-src-"));
		tempDirs.push(srcDir);
		mkdirSync(join(srcDir, "auth"), { recursive: true });
		const srcMd = join(srcDir, "auth", "spec.md");
		writeFileSync(
			srcMd,
			"## ADDED Requirements\n\n### Requirement: login\n#### Scenario: ok\n- WHEN valid\n- THEN in\n",
		);
		expect(await specMain(["import", join(srcDir, "auth")])).toBe(0);
		const dst = readFileSync(join(repoDir, "specs", "auth", "spec.md"), "utf8");
		expect(dst).toContain("(format: openspec)");
		expect(dst).toContain("### Requirement: login");
		// Source untouched.
		expect(readFileSync(srcMd, "utf8")).not.toContain("imported read-only");
		// Never overwrites an existing capability.
		expect(await specMain(["import", join(srcDir, "auth")])).toBe(1);
	});

	test("import detects Spec Kit format", async () => {
		const srcDir = mkdtempSync(join(tmpdir(), "fc-spec-kit-"));
		tempDirs.push(srcDir);
		writeFileSync(
			join(srcDir, "spec.md"),
			"## User Stories\n\n- As a user, I want out.\n",
		);
		expect(await specMain(["import", srcDir, "--capability", "kit-cap"])).toBe(0);
		const dst = readFileSync(join(repoDir, "specs", "kit-cap", "spec.md"), "utf8");
		expect(dst).toContain("(format: speckit)");
	});
});
