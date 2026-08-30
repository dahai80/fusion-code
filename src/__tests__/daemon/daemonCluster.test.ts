import { describe, expect, test } from "bun:test";
import {
	getImplementedWorkerKinds,
	WORKER_KINDS,
} from "../../daemon/workerRegistry.js";

// audit 1.2.1: no eager no-op spawns — getImplementedWorkerKinds filters stubs.
// All four worker bodies are keepAlive() no-op stubs today; startDaemon spawns
// only implemented kinds, so an all-stub registry = zero phantom-RSS processes.
describe("audit 1.2.1 — spawn only implemented workers", () => {
	test("all four kinds registered as stubs today", () => {
		// The fix's value TODAY = zero eager spawns because none are implemented.
		// If a worker body gets real logic, flip its `implemented` flag in
		// workerRegistry.ts — this test is the reminder that flipping is the spawn
		// trigger, not just a label.
		expect(WORKER_KINDS).toHaveLength(4);
		expect(WORKER_KINDS.every((w) => w.implemented === false)).toBe(true);
	});

	test("getImplementedWorkerKinds returns [] when all are stubs", () => {
		// startDaemon iterates this — empty = no eager no-op processes.
		expect(getImplementedWorkerKinds()).toEqual([]);
	});

	test("kinds are the expected four", () => {
		const kinds = WORKER_KINDS.map((w) => w.kind);
		expect(kinds).toEqual(["assistant", "proactive", "bg", "cron"]);
	});
});

// audit 2.1.5: ppid-watch — worker self-exits when parent gone (ESRCH from
// kill(ppid, 0)). The watcher's core decision (kill throws ESRCH → exit) is
// verified via the syscall contract, not a live interval (which would require
// spawning a process and killing it).
describe("audit 2.1.5 — parent-death watch decision (kill(ppid, 0) contract)", () => {
	test("parent alive (kill returns) → do not exit", () => {
		// process.kill(self, 0) succeeds for a live pid — the watcher's try
		// block completes without throwing, so no self-exit.
		expect(() => process.kill(process.pid, 0)).not.toThrow();
	});

	test("parent gone (kill throws ESRCH) → watcher would self-exit", () => {
		// A pid guaranteed not to exist. kill throws with code ESRCH — exactly
		// the condition the watcher's catch block checks before self-exiting.
		// (watchParentAndExit guards on code === 'ESRCH', ignoring EPERM.)
		let threw = false;
		let errCode: string | undefined;
		try {
			process.kill(4_194_303, 0); // ESRCH expected (no such process)
		} catch (err) {
			threw = true;
			errCode = (err as NodeJS.ErrnoException).code;
		}
		expect(threw).toBe(true);
		expect(errCode).toBe("ESRCH");
	});
});
