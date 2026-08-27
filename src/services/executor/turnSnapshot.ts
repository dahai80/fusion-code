// Phase 3b turn-boundary snapshot/rollback manager — caller-owned turn-level
// git snapshot, complementary to in-band auto-rollback (PR #139).
// in-band = single-call self-contained, opt-in FUSION_CODE_EXECUTOR_AUTO_ROLLBACK.
// turn-boundary = caller owns the snapshot at submitMessage entry; /rollback
// reverts the working tree to before the turn. Manual (model/user decides),
// NOT automatic — safer than auto-rollback for the edit-test-fail coding loop.
//
// Gate: default off, env FUSION_CODE_EXECUTOR_TURN_SNAPSHOT=1 (strict truthy).
// Byte-identical when env unset: takeTurnSnapshot is a no-op, returns null.
// Non-repo cwd: executor returns snapshot_id="" → treated as no-op (same safety
// semantics as in-band). Disk bounded by a ring of the last 5 turns; older
// snapshots are GC'd by the executor side (git objects, reflog expiry).
//
// Failure counter: same-turn tool failures (is_error) counted; at 3, inject a
// "rollback available" hint so the model can decide to /rollback. The hint is
// surfaced via lastHint() — QueryEngine reads it after the turn's tool results.

import { getCwd } from "../../utils/cwd.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { getExecutorClient } from "./manager.js";
import type { ExecutorClientLike } from "./executorDriver.js";

// Test injection seam — lets turnSnapshot.test.ts fake the client + manager.
let _testClient: ExecutorClientLike | undefined;
let _testEnabled: boolean | undefined;
let _testCwd: string | undefined;

export function _setTurnSnapshotClientForTesting(
	client: ExecutorClientLike | undefined,
): void {
	_testClient = client;
}
export function _setTurnSnapshotEnabledForTesting(
	enabled: boolean | undefined,
): void {
	_testEnabled = enabled;
}
export function _setTurnSnapshotCwdForTesting(cwd: string | undefined): void {
	_testCwd = cwd;
}

export function isTurnSnapshotEnabled(): boolean {
	if (_testEnabled !== undefined) return _testEnabled;
	return isEnvTruthy(process.env.FUSION_CODE_EXECUTOR_TURN_SNAPSHOT);
}

const RING_SIZE = 5;
const FAILURE_THRESHOLD = 3;

type TurnSnapshot = {
	turnId: string;
	snapshotId: string;
	cwd: string;
	time: number;
	failures: number;
	hintInjected: boolean;
};

const ring: TurnSnapshot[] = [];
let currentTurn: TurnSnapshot | undefined;
let pendingHint: string | undefined;

function resolveClient(): ExecutorClientLike | undefined {
	return _testClient ?? (getExecutorClient() as unknown as ExecutorClientLike | undefined);
}

function resolveCwd(): string {
	return _testCwd ?? getCwd();
}

// Take a turn-boundary snapshot at submitMessage entry. Returns the turnId
// (caller binds it to the turn), or null when disabled / unavailable / non-repo.
// Never throws — a snapshot failure is fail-soft (turn proceeds without rollback).
export async function takeTurnSnapshot(
	turnId: string,
): Promise<string | null> {
	_resetCurrentTurn();
	if (!isTurnSnapshotEnabled()) return null;
	const client = resolveClient();
	if (!client) {
		logForDebugging(
			"turnSnapshot: executor unavailable, skipping snapshot (fail-soft)",
		);
		return null;
	}
	const cwd = resolveCwd();
	let snapshotId = "";
	try {
		const res = await client.snapshotCreate(cwd);
		snapshotId = res.snapshot_id ?? "";
	} catch (e) {
		logForDebugging(
			`turnSnapshot: snapshotCreate failed (fail-soft): ${(e as Error).message}`,
		);
		return null;
	}
	if (!snapshotId) {
		// Non-repo cwd → executor returns "". No-op, no ring entry, no error.
		logForDebugging(
			"turnSnapshot: empty snapshot_id (non-repo cwd), skipping",
		);
		return null;
	}
	const snap: TurnSnapshot = {
		turnId,
		snapshotId,
		cwd,
		time: Date.now(),
		failures: 0,
		hintInjected: false,
	};
	ring.push(snap);
	while (ring.length > RING_SIZE) ring.shift();
	currentTurn = snap;
	logForDebugging(`turnSnapshot: took snapshot ${snapshotId} for turn ${turnId}`);
	return turnId;
}

// Record a tool failure (is_error) against the current turn. At the threshold,
// stage a rollback hint for the model via lastHint(). Idempotent per turn —
// the hint is injected once even if failures keep climbing.
export function recordTurnFailure(): void {
	if (!currentTurn) return;
	currentTurn.failures++;
	if (
		currentTurn.failures >= FAILURE_THRESHOLD &&
		!currentTurn.hintInjected
	) {
		currentTurn.hintInjected = true;
		pendingHint =
			`<note>This turn has ${currentTurn.failures} tool failures. ` +
			`You can revert the working tree to before this turn with \`/rollback\` ` +
			`if the failures stem from a bad edit.</note>`;
		logForDebugging(
			`turnSnapshot: failure threshold reached for turn ${currentTurn.turnId}, hint staged`,
		);
	}
}

// Read + clear the staged rollback hint. QueryEngine calls this after tool
// results to surface the hint to the model. Returns undefined when no hint.
export function lastHint(): string | undefined {
	const h = pendingHint;
	pendingHint = undefined;
	return h;
}

// Rollback the working tree to before a turn. Defaults to the most recent
// snapshotted turn when turnId is omitted. Returns true on success.
export async function rollbackToTurn(
	turnId?: string,
): Promise<boolean> {
	const snap = turnId
		? ring.find((s) => s.turnId === turnId)
		: ring[ring.length - 1];
	if (!snap) {
		logForDebugging(
			`turnSnapshot: no snapshot to rollback${turnId ? ` for turn ${turnId}` : ""}`,
		);
		return false;
	}
	const client = resolveClient();
	if (!client) {
		logForDebugging("turnSnapshot: executor unavailable for rollback");
		return false;
	}
	try {
		const res = await client.rollback(snap.snapshotId, snap.cwd);
		const ok = res.ok === true;
		logForDebugging(
			`turnSnapshot: rollback turn ${snap.turnId} (snapshot ${snap.snapshotId}) → ok=${ok}`,
		);
		if (ok) {
			// Drop rolled-back turns + newer ones from the ring — they're stale.
			const idx = ring.indexOf(snap);
			if (idx !== -1) ring.splice(idx);
			if (currentTurn === snap) currentTurn = undefined;
		}
		return ok;
	} catch (e) {
		logForDebugging(
			`turnSnapshot: rollback failed for turn ${snap.turnId}: ${(e as Error).message}`,
		);
		return false;
	}
}

// List recent snapshotted turns (newest last) — for /rollback UX + tests.
export function listTurnSnapshots(): TurnSnapshot[] {
	return ring.slice();
}

// Reset the current-turn tracking — called at submitMessage entry so the
// failure counter + hint don't bleed across turns.
function _resetCurrentTurn(): void {
	currentTurn = undefined;
	pendingHint = undefined;
}

// Test-only full reset.
export function _resetTurnSnapshotForTesting(): void {
	ring.length = 0;
	currentTurn = undefined;
	pendingHint = undefined;
	_testClient = undefined;
	_testEnabled = undefined;
	_testCwd = undefined;
}
