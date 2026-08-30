import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	_setTurnSnapshotClientForTesting,
	_setTurnSnapshotCwdForTesting,
	_setTurnSnapshotEnabledForTesting,
	_resetTurnSnapshotForTesting,
	isTurnSnapshotEnabled,
	lastHint,
	listTurnSnapshots,
	recordTurnFailure,
	rollbackToTurn,
	takeTurnSnapshot,
} from "../../../services/executor/index.js";
import type { ExecutorClientLike } from "../../../services/executor/index.js";

const TURN_SNAP_ENV = "FUSION_CODE_EXECUTOR_TURN_SNAPSHOT";

// Fake client — records calls, returns scripted snapshot_id / rollback ok.
function makeFakeClient(opts?: {
	snapshotId?: string;
	rollbackOk?: boolean;
	throwOnSnapshot?: boolean;
}): {
	client: ExecutorClientLike;
	snapshotCalls: string[];
	rollbackCalls: { snapshotId: string; cwd: string }[];
} {
	const snapshotCalls: string[] = [];
	const rollbackCalls: { snapshotId: string; cwd: string }[] = [];
	const snapshotId = opts?.snapshotId ?? "snap-1";
	const rollbackOk = opts?.rollbackOk ?? true;
	const client: ExecutorClientLike = {
		executeStream: (async () => ({
			exit_code: 0,
			stdout: "",
			stderr: "",
			duration_sec: 0,
			timed_out: false,
			blocked_by_security: false,
			auto_rolled_back: false,
		})) as ExecutorClientLike["executeStream"],
		snapshotCreate: async (cwd: string) => {
			snapshotCalls.push(cwd);
			if (opts?.throwOnSnapshot) {
				throw new Error("snapshot boom");
			}
			return { snapshot_id: snapshotId };
		},
		rollback: async (snapshotId: string, cwd: string) => {
			rollbackCalls.push({ snapshotId, cwd });
			return { ok: rollbackOk };
		},
	};
	return { client, snapshotCalls, rollbackCalls };
}

describe("turnSnapshot", () => {
	beforeEach(() => {
		_resetTurnSnapshotForTesting();
		delete process.env[TURN_SNAP_ENV];
	});

	afterEach(() => {
		_resetTurnSnapshotForTesting();
		delete process.env[TURN_SNAP_ENV];
	});

	describe("isTurnSnapshotEnabled", () => {
		it("returns false when env unset (default off, byte-identical)", () => {
			delete process.env[TURN_SNAP_ENV];
			expect(isTurnSnapshotEnabled()).toBe(false);
		});

		it("returns false for empty/falsy env values (strict truthy)", () => {
			process.env[TURN_SNAP_ENV] = "";
			expect(isTurnSnapshotEnabled()).toBe(false);
			process.env[TURN_SNAP_ENV] = "0";
			expect(isTurnSnapshotEnabled()).toBe(false);
		});

		it("returns true when env=1", () => {
			process.env[TURN_SNAP_ENV] = "1";
			expect(isTurnSnapshotEnabled()).toBe(true);
		});

		it("test override takes precedence over env", () => {
			_setTurnSnapshotEnabledForTesting(true);
			delete process.env[TURN_SNAP_ENV];
			expect(isTurnSnapshotEnabled()).toBe(true);
		});
	});

	describe("takeTurnSnapshot", () => {
		it("returns null when disabled (no client call, no ring entry)", async () => {
			const { client, snapshotCalls } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(false);
			_setTurnSnapshotCwdForTesting("/repo");

			const res = await takeTurnSnapshot("turn-a");
			expect(res).toBeNull();
			expect(snapshotCalls).toHaveLength(0);
			expect(listTurnSnapshots()).toHaveLength(0);
		});

		it("returns null when client unavailable (fail-soft)", async () => {
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotClientForTesting(undefined);
			const res = await takeTurnSnapshot("turn-a");
			expect(res).toBeNull();
		});

		it("returns turnId + stores ring entry on success", async () => {
			const { client, snapshotCalls } = makeFakeClient({
				snapshotId: "snap-xyz",
			});
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");

			const res = await takeTurnSnapshot("turn-1");
			expect(res).toBe("turn-1");
			expect(snapshotCalls).toEqual(["/repo"]);
			const snaps = listTurnSnapshots();
			expect(snaps).toHaveLength(1);
			expect(snaps[0].snapshotId).toBe("snap-xyz");
			expect(snaps[0].turnId).toBe("turn-1");
		});

		it("treats empty snapshot_id as non-repo no-op (no ring entry)", async () => {
			const { client } = makeFakeClient({ snapshotId: "" });
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/non-repo");

			const res = await takeTurnSnapshot("turn-1");
			expect(res).toBeNull();
			expect(listTurnSnapshots()).toHaveLength(0);
		});

		it("swallows snapshotCreate throw (fail-soft, returns null)", async () => {
			const { client } = makeFakeClient({ throwOnSnapshot: true });
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");

			const res = await takeTurnSnapshot("turn-1");
			expect(res).toBeNull();
			expect(listTurnSnapshots()).toHaveLength(0);
		});

		it("ring caps at 5 (oldest evicted)", async () => {
			const { client } = makeFakeClient({ snapshotId: "snap" });
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");

			for (let i = 0; i < 7; i++) {
				await takeTurnSnapshot(`turn-${i}`);
			}
			const snaps = listTurnSnapshots();
			expect(snaps).toHaveLength(5);
			expect(snaps[0].turnId).toBe("turn-2");
			expect(snaps[4].turnId).toBe("turn-6");
		});
	});

	describe("recordTurnFailure + lastHint", () => {
		it("stages hint at failure threshold 3 (idempotent — one hint)", async () => {
			const { client } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");

			recordTurnFailure("turn-1");
			recordTurnFailure("turn-1");
			expect(lastHint("turn-1")).toBeUndefined();
			recordTurnFailure("turn-1");
			const hint = lastHint("turn-1");
			expect(hint).toContain("/rollback");
			// Further failures do not re-stage (hintInjected guard).
			recordTurnFailure("turn-1");
			expect(lastHint("turn-1")).toBeUndefined();
		});

		it("no hint when no current turn (failures ignored)", () => {
			recordTurnFailure("no-such-turn");
			recordTurnFailure("no-such-turn");
			recordTurnFailure("no-such-turn");
			expect(lastHint("no-such-turn")).toBeUndefined();
		});

		it("takeTurnSnapshot resets current-turn tracking (no bleed across turns)", async () => {
			const { client } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");
			recordTurnFailure("turn-1");
			recordTurnFailure("turn-1");

			await takeTurnSnapshot("turn-2");
			recordTurnFailure("turn-2");
			// turn-2 only has 1 failure → no hint (turn-1's 2 don't bleed).
			expect(lastHint("turn-2")).toBeUndefined();
		});
	});

	describe("rollbackToTurn", () => {
		it("reverts most recent turn when turnId omitted", async () => {
			const { client, rollbackCalls } = makeFakeClient({
				rollbackOk: true,
			});
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");
			await takeTurnSnapshot("turn-2");

			const ok = await rollbackToTurn();
			expect(ok).toBe(true);
			expect(rollbackCalls).toHaveLength(1);
			expect(rollbackCalls[0].snapshotId).toBe("snap-1");
		});

		it("reverts specific turn by turnId", async () => {
			const { client, rollbackCalls } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");
			const res = await takeTurnSnapshot("turn-2");
			expect(res).toBe("turn-2");

			const ok = await rollbackToTurn("turn-1");
			expect(ok).toBe(true);
			expect(rollbackCalls[0].snapshotId).toBe("snap-1");
		});

		it("returns false when no snapshot found for turnId", async () => {
			const { client } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");

			const ok = await rollbackToTurn("nonexistent");
			expect(ok).toBe(false);
		});

		it("returns false when ring empty", async () => {
			_setTurnSnapshotEnabledForTesting(true);
			const ok = await rollbackToTurn();
			expect(ok).toBe(false);
		});

		it("drops rolled-back + newer turns from ring on success", async () => {
			const { client } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");
			await takeTurnSnapshot("turn-2");
			await takeTurnSnapshot("turn-3");

			await rollbackToTurn("turn-2");
			const snaps = listTurnSnapshots();
			expect(snaps).toHaveLength(1);
			expect(snaps[0].turnId).toBe("turn-1");
		});

		it("returns false when executor rollback reports ok=false", async () => {
			const { client } = makeFakeClient({ rollbackOk: false });
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");

			const ok = await rollbackToTurn();
			expect(ok).toBe(false);
		});

		it("swallows rollback throw (returns false)", async () => {
			const { client } = makeFakeClient();
			client.rollback = async () => {
				throw new Error("rollback boom");
			};
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(true);
			_setTurnSnapshotCwdForTesting("/repo");
			await takeTurnSnapshot("turn-1");

			const ok = await rollbackToTurn();
			expect(ok).toBe(false);
		});
	});

	describe("default-off byte-identical", () => {
		it("disabled path: no client, no ring, no hint — all no-ops", async () => {
			const { client, snapshotCalls, rollbackCalls } = makeFakeClient();
			_setTurnSnapshotClientForTesting(client);
			_setTurnSnapshotEnabledForTesting(false);
			_setTurnSnapshotCwdForTesting("/repo");

			const snap = await takeTurnSnapshot("turn-1");
			const ok = await rollbackToTurn();
			recordTurnFailure("turn-1");
			const hint = lastHint("turn-1");

			expect(snap).toBeNull();
			expect(ok).toBe(false);
			expect(hint).toBeUndefined();
			expect(snapshotCalls).toHaveLength(0);
			expect(rollbackCalls).toHaveLength(0);
			expect(listTurnSnapshots()).toHaveLength(0);
		});
	});
});
