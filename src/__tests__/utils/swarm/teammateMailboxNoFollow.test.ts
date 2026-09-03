import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// audit-0903 P1 SEC-2: writeToMailbox must NOT follow a symlinked inbox.
// writeFile with the default 'w' flag follows symlinks — a same-user process
// that swaps an inbox for a symlink could redirect agent messages to an
// arbitrary target. writeInboxNoFollow uses O_NOFOLLOW (opens the path only
// if it is NOT a symlink, ELOOP otherwise), matching the auditLog defense.
// Real-fs test: no module mocks beyond the config-home redirect.

let _configHome = "";
const realEnvUtils = await import("../../../utils/envUtils.js");
mock.module("../../../utils/envUtils.js", () => ({
	...realEnvUtils,
	getClaudeConfigHomeDir: () => _configHome,
}));

const { writeToMailbox, getInboxPath } = await import(
	"../../../utils/teammateMailbox.js"
);

describe("teammateMailbox O_NOFOLLOW (audit-0903 P1 SEC-2)", () => {
	beforeEach(async () => {
		_configHome = await mkdtemp(join(tmpdir(), "mailbox-nofollow-"));
	});
	afterEach(async () => {
		await rm(_configHome, { recursive: true, force: true });
	});

	it("writes to a real inbox file normally", async () => {
		await writeToMailbox("lead", {
			from: "alice",
			text: "hi",
			timestamp: new Date(0).toISOString(),
		});
		const raw = await readFile(getInboxPath("lead"), "utf8");
		expect(JSON.parse(raw).length).toBe(1);
	});

	it("does not follow a symlinked inbox — target stays untouched", async () => {
		// Create the teams/inbox dir structure first via a legitimate write.
		await writeToMailbox("pwn", {
			from: "seed",
			text: "seed",
			timestamp: new Date(0).toISOString(),
		});
		const inbox = getInboxPath("pwn");
		// Swap the inbox file for a symlink pointing at an outside target.
		const target = join(_configHome, "stolen.txt");
		await writeFile(target, "SECRET");
		await rm(inbox, { force: true });
		await symlink(target, inbox);

		// writeToMailbox fail-opens (swallows the ELOOP internally), so this
		// does not reject — but the SECURITY invariant is that the symlink
		// target is NEVER written: the attacker message must not land in
		// stolen.txt. writeInboxNoFollow's O_NOFOLLOW throws ELOOP before any
		// bytes hit the target.
		await writeToMailbox("pwn", {
			from: "attacker",
			text: "redirected",
			timestamp: new Date(0).toISOString(),
		});

		// The secret target is byte-identical — no message was appended.
		expect(await readFile(target, "utf8")).toBe("SECRET");
	});
});
