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

// P1-6: ring 是跨 turn 历史快照 (last-5 GC, /rollback 按 turnId 取, 共享安全);
// 但 currentTurn + pendingHint 此前是模块单例 → 并发 in-process QueryEngine
// (subagent 共享进程) 交叉: Turn A takeTurnSnapshot 清了 Turn B 的 currentTurn,
// Turn B 的失败计入 Turn A, /rollback 回滚错 turn。改为按 turnId 键控 per-turn 状态。
const ring: TurnSnapshot[] = [];
const turnStateByTurnId = new Map<string, TurnSnapshot>();
const pendingHintByTurnId = new Map<string, string>();

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
	// P1-6: 按 turnId 清本 turn 的 per-turn 状态 (而非模块单例), 隔离并发 QueryEngine。
	turnStateByTurnId.delete(turnId);
	pendingHintByTurnId.delete(turnId);
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
	turnStateByTurnId.set(turnId, snap);
	logForDebugging(`turnSnapshot: took snapshot ${snapshotId} for turn ${turnId}`);
	return turnId;
}

// Record a tool failure (is_error) against a turn. At the threshold,
// stage a rollback hint for the model via lastHint(turnId). Idempotent per turn —
// the hint is injected once even if failures keep climbing.
// P1-6: turnId 键控 → 并发 QueryEngine 各自的失败互不污染。
export function recordTurnFailure(turnId: string): void {
	const turn = turnStateByTurnId.get(turnId);
	if (!turn) return;
	turn.failures++;
	if (
		turn.failures >= FAILURE_THRESHOLD &&
		!turn.hintInjected
	) {
		turn.hintInjected = true;
		pendingHintByTurnId.set(
			turnId,
			`<note>This turn has ${turn.failures} tool failures. ` +
				`You can revert the working tree to before this turn with \`/rollback\` ` +
				`if the failures stem from a bad edit.</note>`,
		);
		logForDebugging(
			`turnSnapshot: failure threshold reached for turn ${turn.turnId}, hint staged`,
		);
	}
}

// Read + clear the staged rollback hint for a turn. QueryEngine calls this after
// tool results to surface the hint to the model. Returns undefined when no hint.
export function lastHint(turnId: string): string | undefined {
	const h = pendingHintByTurnId.get(turnId);
	pendingHintByTurnId.delete(turnId);
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
			// P1-6: 清本 turn 的 per-turn 状态 (turnId 键控)。
			turnStateByTurnId.delete(snap.turnId);
			pendingHintByTurnId.delete(snap.turnId);
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

// Test-only full reset.
export function _resetTurnSnapshotForTesting(): void {
	ring.length = 0;
	turnStateByTurnId.clear();
	pendingHintByTurnId.clear();
	_testClient = undefined;
	_testEnabled = undefined;
	_testCwd = undefined;
}
