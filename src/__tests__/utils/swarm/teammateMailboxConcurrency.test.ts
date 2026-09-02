import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// audit-0902 P2-2: writeToMailbox does read-modify-write under a proper-lockfile
// lock. The lock's retry budget was 10 — under sustained contention (>10
// concurrent writers) it exhausted and the catch silently dropped the message
// (caller unaware, violates fail-visible). Fix: retries 10 -> 30 + a loud
// "MESSAGE DROPPED" log. This test asserts the durable contract: N concurrent
// writes all land (no lost message), which only holds if the lock retries
// survive the contention. 30 retries comfortably covers a 20-way race.

let _configHome = "";
const realEnvUtils = await import("../../../utils/envUtils.js");
mock.module("../../../utils/envUtils.js", () => ({
	...realEnvUtils,
	getClaudeConfigHomeDir: () => _configHome,
}));

const { writeToMailbox, readMailbox, getInboxPath } = await import(
	"../../../utils/teammateMailbox.js"
);

describe("teammateMailbox concurrency (audit-0902 P2-2)", () => {
	beforeEach(async () => {
		_configHome = await mkdtemp(join(tmpdir(), "mailbox-"));
	});
	afterEach(async () => {
		await rm(_configHome, { recursive: true, force: true });
	});

	it("concurrent writes all land (no lost message)", async () => {
		// 20 agents each post one message to the same recipient's inbox
		// simultaneously. Pre-fix (retries=10) a subset could exhaust the
		// lock budget and be dropped; post-fix (retries=30) all 20 survive.
		const N = 20;
		const writes = Array.from({ length: N }, (_, i) =>
			writeToMailbox("lead", {
				from: `agent${i}`,
				text: `msg-${i}`,
				timestamp: new Date(0).toISOString(),
			}),
		);
		await Promise.all(writes);
		const messages = await readMailbox("lead");
		expect(messages.length).toBe(N);
		const froms = messages.map((m) => m.from).sort();
		expect(froms).toEqual(
			Array.from({ length: N }, (_, i) => `agent${i}`).sort(),
		);
	});

	it("written message persists with read=false", async () => {
		await writeToMailbox("lead", {
			from: "alice",
			text: "hello",
			timestamp: new Date(0).toISOString(),
		});
		const raw = await readFile(getInboxPath("lead"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.length).toBe(1);
		expect(parsed[0].from).toBe("alice");
		expect(parsed[0].read).toBe(false);
	});
});
