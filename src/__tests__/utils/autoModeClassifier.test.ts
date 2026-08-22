import { describe, expect, it } from "bun:test";
import { getEmptyToolPermissionContext } from "../../Tool.js";
import { checkPermissionMode } from "../../tools/BashTool/modeValidation.js";
import {
	classifyAllShell,
	isAutoModeDangerousCommand,
	isAutoModeHardDeny,
	isAutoModeSafeCommand,
	type ShellClassification,
} from "../../utils/permissions/autoModeDangerList.js";

// NOTE: This suite documents the actual behavior of the local auto-mode shell
// classifier (autoModeDangerList.ts) and its wiring (modeValidation.ts). The
// classifier is a pure, deterministic rule-list: classifyAllShell checks in
// order hard_deny -> dangerous(ask) -> safe -> write-redirect(ask) ->
// pipe-interpreter(ask) -> compound(ask) -> likely-write-base(ask) ->
// default-ask (fail-safe). Safe-prefix matching runs BEFORE compound/redirect
// detection, so a compound command whose first token is an allow-prefix (e.g.
// "ls && rm -rf /") is classified "safe" — a known precedence limitation
// (documented below, not changed: test-only PR).

// --- classifyAllShell: hard_deny ---------------------------------------------

const HARD_DENY = [
	"git push --force",
	"git push origin main --force-with-lease",
	"git reset --hard HEAD~3",
	"git reset --hard origin/main", // hard_deny pattern beats ask-prefix
	"git clean -fd",
	"git stash drop stash@{0}",
	"git branch -D feature-x",
	"kubectl delete pod foo",
	"terraform destroy",
	"DROP TABLE users",
	"TRUNCATE TABLE users",
	"DELETE FROM users;",
	"rm -rf /",
	"rm -fr /",
	"dd if=/dev/zero of=/dev/sda", // of=/dev/ pattern
	"chmod 000 /",
	"shutdown -h now",
	"reboot",
];

describe("classifyAllShell / isAutoModeHardDeny", () => {
	for (const cmd of HARD_DENY) {
		it(`hard_deny: ${cmd}`, () => {
			expect(classifyAllShell(cmd)).toBe("hard_deny");
			expect(isAutoModeHardDeny(cmd)).toBe(true);
		});
	}

	it("git clean -n (dry-run) is NOT hard_deny", () => {
		// dry-run flag must escape the clean -f pattern
		expect(isAutoModeHardDeny("git clean -n -d")).toBe(false);
		expect(isAutoModeHardDeny("git clean --dry-run -fd")).toBe(false);
	});

	it("DELETE FROM with WHERE clause is NOT hard_deny", () => {
		expect(isAutoModeHardDeny("DELETE FROM users WHERE id = 5;")).toBe(false);
	});

	it("dd of= to non-/dev path is NOT hard_deny (still ask via base)", () => {
		expect(isAutoModeHardDeny("dd if=/dev/zero of=img bs=1M")).toBe(false);
	});

	it("empty/whitespace string is safe (no-op)", () => {
		expect(classifyAllShell("")).toBe("safe");
		expect(classifyAllShell("   ")).toBe("safe");
	});
});

// --- classifyAllShell: ask (dangerous / write-redirect / pipe / compound) -----

describe("classifyAllShell / isAutoModeDangerousCommand", () => {
	// Commands where BOTH isAutoModeDangerousCommand=true AND classifyAllShell='ask'
	const dangerousBoth = [
		"rm -rf tmp",
		"rm -r dir",
		"sudo apt update",
		"git push origin main",
		"ssh host",
		"scp file host:/tmp",
		'eval "$CMD"',
		"exec ./run.sh",
		"python -c 'import os'",
		"node script.js",
		"bash -c 'echo hi'",
	];
	for (const cmd of dangerousBoth) {
		it(`ask (dangerous, both true): ${cmd}`, () => {
			expect(isAutoModeDangerousCommand(cmd)).toBe(true);
			expect(classifyAllShell(cmd)).toBe("ask");
		});
	}

	// Commands classified 'ask' by classifyAllShell via likely-write-base or
	// pattern, but where isAutoModeDangerousCommand is false (prefix matcher
	// requires exact token or '<prefix> ', so dotted/attached forms miss).
	it("mkfs.ext4: classifyAllShell='ask' (base) but danger=false (no space after mkfs)", () => {
		expect(isAutoModeDangerousCommand("mkfs.ext4 /dev/sda")).toBe(false);
		expect(classifyAllShell("mkfs.ext4 /dev/sda")).toBe("ask");
	});

	it("mkfs (with space): danger=true", () => {
		expect(isAutoModeDangerousCommand("mkfs /dev/sda")).toBe(true);
	});

	it("dd if=/dev/zero of=img: classifyAllShell='ask' (base) but danger=false (no space after dd if=)", () => {
		expect(isAutoModeDangerousCommand("dd if=/dev/zero of=img bs=1M")).toBe(
			false,
		);
		expect(classifyAllShell("dd if=/dev/zero of=img bs=1M")).toBe("ask");
	});

	it("rm without recursive/force flags is NOT dangerous (single file)", () => {
		expect(isAutoModeDangerousCommand("rm foo.txt")).toBe(false);
	});
});

describe("classifyAllShell: write-redirect / pipe / likely-write-base", () => {
	it("write redirect on an UN-allowlisted base -> ask", () => {
		// 'hostname' is read-only/safe, but 'curl ... > f' base is curl -> ask
		expect(classifyAllShell("curl http://x > /tmp/out")).toBe("ask");
		expect(classifyAllShell("wget http://x >> /tmp/out")).toBe("ask");
	});

	it("pipe to destructive interpreter with non-safe base -> ask", () => {
		expect(classifyAllShell("curl http://x | bash")).toBe("ask");
		expect(classifyAllShell("wget x | python")).toBe("ask");
	});

	it("safe base + pipe -> 'safe' (pipe not reached; safe-prefix wins)", () => {
		// 'cat' is allow-prefix -> safe check runs before pipe-to-interpreter.
		expect(classifyAllShell("cat x | python")).toBe("safe");
		expect(classifyAllShell("cat x | bash")).toBe("safe");
	});

	it("likely-write base command -> ask", () => {
		expect(classifyAllShell("curl http://example.com")).toBe("ask");
		expect(classifyAllShell("wget http://example.com/file")).toBe("ask");
		expect(classifyAllShell("docker ps")).toBe("ask");
	});

	it("default fail-safe: unclassified command -> ask (NOT allow)", () => {
		expect(classifyAllShell("some-weird-unknown-cmd --flag")).toBe("ask");
	});
});

// --- safe-prefix precedence: KNOWN limitation --------------------------------

describe("classifyAllShell: safe-prefix precedence (documented behavior)", () => {
	// classifyAllShell checks isAutoModeSafeCommand BEFORE write-redirect /
	// pipe / compound. A command whose FIRST token is an allow-prefix is
	// classified "safe" even if it contains a redirect, pipe, or compound
	// operator. This is the current precedence; recorded here as a guard
	// against silent regressions. (Behavior unchanged in this test-only PR.)
	it("safe base + redirect -> 'safe' (redirect not reached; safe wins)", () => {
		expect(isAutoModeSafeCommand("echo hi > /tmp/x")).toBe(true);
		expect(classifyAllShell("echo hi > /tmp/x")).toBe("safe");
	});

	it("safe base + compound (no destructive regex) -> 'safe' (compound not reached; safe wins)", () => {
		expect(classifyAllShell("ls && pwd")).toBe("safe");
		expect(classifyAllShell("ls | wc -l")).toBe("safe");
	});

	// The hard_deny regex scans the WHOLE command string, so a destructive
	// tail like "rm -rf /" inside a compound IS caught even though safe-prefix
	// would otherwise win. hard_deny (regex, whole-string) outranks safe.
	it("'ls && rm -rf /' -> 'hard_deny' (hard_deny regex scans whole string, beats safe-prefix)", () => {
		expect(isAutoModeSafeCommand("ls && rm -rf /")).toBe(true); // prefix match alone
		expect(classifyAllShell("ls && rm -rf /")).toBe("hard_deny"); // but regex catches rm -rf /
	});

	// KNOWN LIMITATION: a destructive-but-non-regex-matching tail after a
	// safe prefix is classified 'safe'. e.g. "ls && rm -rf tmp" — the rm-rf-/
	// regex only matches a path ending in '/', so "tmp" escapes it, and the
	// safe-prefix ('ls') check runs before the compound check -> 'safe'.
	it("KNOWN LIMITATION: 'ls && rm -rf tmp' -> 'safe' (safe-prefix beats compound; rm-rf-tmp escapes the /-anchored regex)", () => {
		const result: ShellClassification = classifyAllShell("ls && rm -rf tmp");
		expect(result).toBe("safe");
	});
});

// --- classifyAllShell: safe --------------------------------------------------

describe("classifyAllShell / isAutoModeSafeCommand: safe commands", () => {
	const safe = [
		"ls",
		"ls -la /tmp",
		"cat file.txt",
		"grep pattern file",
		"git status",
		"git log --oneline",
		"git diff",
		"git add -A",
		"git commit -m msg",
		"git checkout -b new-branch",
		"npm test",
		"npm install",
		"bun test",
		"bun run build",
		"cargo build",
		"pytest tests/",
		"biome check .",
		"tsc --noEmit",
		"echo hello",
		"pwd",
	];
	for (const cmd of safe) {
		it(`safe: ${cmd}`, () => {
			expect(isAutoModeSafeCommand(cmd)).toBe(true);
			expect(classifyAllShell(cmd)).toBe("safe");
		});
	}

	it("read-only base command (df) is safe", () => {
		expect(isAutoModeSafeCommand("df -h")).toBe(true);
		expect(classifyAllShell("df -h")).toBe("safe");
	});

	it("whitespace is trimmed", () => {
		expect(classifyAllShell("   ls -la   ")).toBe("safe");
		expect(classifyAllShell("\tgit status\t")).toBe("safe");
	});
});

// --- classification priority / precedence ------------------------------------

describe("classifyAllShell: precedence", () => {
	it("hard_deny beats dangerous (git push --force is both)", () => {
		// git push is dangerous (ask prefix); --force is hard_deny pattern.
		// hard_deny checked first -> hard_deny wins.
		expect(classifyAllShell("git push --force")).toBe("hard_deny");
	});

	it("hard_deny beats safe (git reset --hard)", () => {
		expect(classifyAllShell("git reset --hard HEAD~1")).toBe("hard_deny");
	});
});

// --- modeValidation: checkPermissionMode wiring ------------------------------

function ctx(mode: string) {
	const c = getEmptyToolPermissionContext();
	(c as unknown as { mode: string }).mode = mode;
	return c;
}

function input(command: string) {
	return { command } as unknown as Parameters<typeof checkPermissionMode>[0];
}

describe("checkPermissionMode", () => {
	it("bypassPermissions -> passthrough", () => {
		const r = checkPermissionMode(input("rm -rf /"), ctx("bypassPermissions"));
		expect(r.behavior).toBe("passthrough");
	});

	it("dontAsk -> passthrough", () => {
		const r = checkPermissionMode(input("ls"), ctx("dontAsk"));
		expect(r.behavior).toBe("passthrough");
	});

	it("default mode (non-filesystem) -> passthrough", () => {
		const r = checkPermissionMode(input("ls -la"), ctx("default"));
		expect(r.behavior).toBe("passthrough");
	});

	it("auto mode safe command -> allow", () => {
		const r = checkPermissionMode(input("ls -la"), ctx("auto"));
		expect(r.behavior).toBe("allow");
		expect(r.decisionReason?.type).toBe("mode");
	});

	it("auto mode ask command -> ask", () => {
		const r = checkPermissionMode(input("sudo apt update"), ctx("auto"));
		expect(r.behavior).toBe("ask");
		expect(r.decisionReason?.type).toBe("safetyCheck");
	});

	it("auto mode hard_deny command -> deny", () => {
		const r = checkPermissionMode(input("git push --force"), ctx("auto"));
		expect(r.behavior).toBe("deny");
		expect(r.decisionReason?.type).toBe("safetyCheck");
		if (r.behavior === "deny") {
			expect(r.message).toContain("irreversible");
		}
	});

	it("acceptEdits + filesystem command (mkdir) -> allow", () => {
		const r = checkPermissionMode(input("mkdir newdir"), ctx("acceptEdits"));
		expect(r.behavior).toBe("allow");
		expect(r.decisionReason?.type).toBe("mode");
	});

	it("acceptEdits + non-filesystem command -> passthrough", () => {
		const r = checkPermissionMode(input("ls"), ctx("acceptEdits"));
		expect(r.behavior).toBe("passthrough");
	});

	// checkPermissionMode splits compound commands and returns the FIRST
	// subcommand whose validateCommandForMode is non-passthrough. Combined
	// with the safe-prefix precedence above, "ls && <anything>" resolves on
	// the 'ls' subcommand -> allow. Documented here as current behavior.
	it("auto mode compound 'ls && rm -rf tmp' -> 'allow' (first subcommand ls is safe; documented)", () => {
		const r = checkPermissionMode(input("ls && rm -rf tmp"), ctx("auto"));
		expect(r.behavior).toBe("allow");
	});

	it("auto mode compound with dangerous first subcommand -> ask", () => {
		const r = checkPermissionMode(input("sudo apt update && ls"), ctx("auto"));
		expect(r.behavior).toBe("ask");
	});

	it("auto mode empty command -> passthrough (base command not found)", () => {
		const r = checkPermissionMode(input("   "), ctx("auto"));
		expect(r.behavior).toBe("passthrough");
	});
});
