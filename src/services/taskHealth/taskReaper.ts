// audit 1.4.3 / 2.1.2 (HIGH): no reaper, no TTL. Stuck/runaway background agents +
// workflows hold MLX memory forever with no release until OOM. This module periodically
// scans AppState.tasks and reaps tasks still running past the TTL (calling stopTask to take
// the real kill path).
//
// default OFF: FUSION_CODE_TASK_REAPER_ENABLED unset → startTaskReaper is a no-op,
// byte-identical to the old behavior. FUSION_CODE_TASK_TTL_MS defaults to 30min.
//
// Same pattern as sessionActivity.ts: module-level singleton timer + start/stop + registerCleanup.

import type { AppState } from "../../state/AppState.js";
import { killAllActive, stopTask } from "../../tasks/stopTask.js";
import { registerCleanup } from "../../utils/cleanupRegistry.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";

// The context shape stopTask expects (StopTaskContext is not exported, inlined here).
type ReapTaskContext = {
	getAppState: () => AppState;
	setAppState: (f: (prev: AppState) => AppState) => void;
};

const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000; // 30 min
const DEFAULT_REAPER_INTERVAL_MS = 60 * 1000; // scan every 60s

let reaperTimer: ReturnType<typeof setInterval> | null = null;
let cleanupRegistered = false;
let killCleanupRegistered = false;

// Injected store accessors (injected at REPL mount). stopTask needs a StopTaskContext.
let injectedGetAppState: (() => AppState) | null = null;
let injectedSetAppState: ((f: (prev: AppState) => AppState) => void) | null =
	null;

function taskTtlMs(): number {
	const raw = process.env.FUSION_CODE_TASK_TTL_MS;
	if (raw === undefined || raw === "") return DEFAULT_TASK_TTL_MS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		logForDebugging(
			`[taskReaper] invalid FUSION_CODE_TASK_TTL_MS "${raw}", defaulting to ${DEFAULT_TASK_TTL_MS}ms`,
		);
		return DEFAULT_TASK_TTL_MS;
	}
	return Math.floor(parsed);
}

function reaperIntervalMs(): number {
	const raw = process.env.FUSION_CODE_TASK_REAPER_INTERVAL_MS;
	if (raw === undefined || raw === "") return DEFAULT_REAPER_INTERVAL_MS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1000) {
		return DEFAULT_REAPER_INTERVAL_MS;
	}
	return Math.floor(parsed);
}

// Periodic scan: find tasks still running whose startTime is older than the TTL, reap via stopTask.
// terminalStatuses matches stopTask.killAllActive (stopTask re-validates running internally).
const TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"killed",
	"lost",
	"stopped",
	"exited",
]);

async function reapOnce(): Promise<void> {
	if (!injectedGetAppState || !injectedSetAppState) return;
	const appState = injectedGetAppState();
	const tasks = appState.tasks ?? {};
	const now = Date.now();
	const ttl = taskTtlMs();
	const ctx: ReapTaskContext = {
		getAppState: injectedGetAppState,
		setAppState: injectedSetAppState,
	};
	for (const [taskId, task] of Object.entries(tasks)) {
		const base = task as { status: string; startTime?: number };
		if (TERMINAL_STATUSES.has(base.status)) continue;
		const start = base.startTime;
		if (typeof start !== "number") continue;
		const age = now - start;
		if (age <= ttl) continue;
		logForDebugging(
			`[taskReaper] reaping task ${taskId} (age ${age}ms > TTL ${ttl}ms)`,
		);
		try {
			await stopTask(taskId, ctx);
		} catch (err) {
			logForDebugging(
				`[taskReaper] failed to reap task ${taskId}: ${(err as Error).message}`,
				{ level: "warn" },
			);
		}
	}
}

// Start the reaper. Called once at REPL mount, injecting the store accessors. env off → no-op.
export function startTaskReaper(accessors: {
	getAppState: () => AppState;
	setAppState: (f: (prev: AppState) => AppState) => void;
}): () => void {
	injectedGetAppState = accessors.getAppState;
	injectedSetAppState = accessors.setAppState;
	// audit 0905 P0-A (zombie leak): kill all running background tasks on process exit.
	// Old implementation: gracefulShutdown only ran runCleanupFunctions; each task's own registerCleanup
	// only removed its state entry (setAppState delete) without calling taskImpl.kill → the child process
	// was adopted by init as a zombie, holding MLX memory/FDs/worktree locks forever. This cleanup takes
	// killAllActive's real kill path.
	// Not gated by FUSION_CODE_TASK_REAPER_ENABLED (periodic reaping is an optional optimization; exit-time
	// kills are required cleanup). byte-safe: no injected accessors (headless/-p, no tasks) or no running tasks → no-op.
	// FUSION_CODE_TASK_KILL_ON_SHUTDOWN=0 explicitly disables this (compat with the old no-kill behavior).
	if (!killCleanupRegistered) {
		killCleanupRegistered = true;
		registerCleanup(async () => {
			// default-on: killAllActive only acts when accessors + running tasks exist.
			// FUSION_CODE_TASK_KILL_ON_SHUTDOWN=0 explicitly disables this (compat with the old no-kill behavior).
			if (
				process.env.FUSION_CODE_TASK_KILL_ON_SHUTDOWN === "0" ||
				!injectedGetAppState ||
				!injectedSetAppState
			) {
				return;
			}
			try {
				const killed = await killAllActive(
					{
						getAppState: injectedGetAppState,
						setAppState: injectedSetAppState,
					},
					"CLI session shutdown",
				);
				if (killed.length > 0) {
					logForDebugging(
						`[taskReaper] shutdown killed ${killed.length} active task(s): ${killed.join(", ")}`,
					);
				}
			} catch (err) {
				logForDebugging(
					`[taskReaper] shutdown killAllActive failed: ${(err as Error).message}`,
					{ level: "warn" },
				);
			}
		});
	}
	if (!isEnvTruthy(process.env.FUSION_CODE_TASK_REAPER_ENABLED)) {
		return stopTaskReaper;
	}
	if (reaperTimer !== null) {
		return stopTaskReaper;
	}
	const interval = reaperIntervalMs();
	reaperTimer = setInterval(() => {
		void reapOnce().catch((err) => {
			logForDebugging(`[taskReaper] scan failed: ${(err as Error).message}`, {
				level: "warn",
			});
		});
	}, interval);
	logForDebugging(
		`[taskReaper] started (interval ${interval}ms, TTL ${taskTtlMs()}ms)`,
	);
	if (!cleanupRegistered) {
		cleanupRegistered = true;
		registerCleanup(async () => {
			stopTaskReaper();
		});
	}
	return stopTaskReaper;
}

export function stopTaskReaper(): void {
	if (reaperTimer !== null) {
		clearInterval(reaperTimer);
		reaperTimer = null;
		logForDebugging("[taskReaper] stopped");
	}
}
