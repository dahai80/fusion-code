// audit 1.4.3 / 2.1.2 (HIGH): 无 reaper, 无 TTL。卡死/失控的后台 agent +
// workflow 永占 MLX 内存只增不减直至 OOM。此模块周期扫描 AppState.tasks,
// reap 超过 TTL 仍 running 的任务 (调 stopTask 走真实 kill 路径)。
//
// 默认 OFF: FUSION_CODE_TASK_REAPER_ENABLED 未设 → startTaskReaper no-op,
// byte-identical 旧行为。FUSION_CODE_TASK_TTL_MS 默认 30min。
//
// 模式同 sessionActivity.ts: 模块级 singleton timer + start/stop + registerCleanup。

import type { AppState } from "../../state/AppState.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { registerCleanup } from "../../utils/cleanupRegistry.js";
import { killAllActive, stopTask } from "../../tasks/stopTask.js";

// stopTask 的 context 形状 (StopTaskContext 未导出, 此处内联)。
type ReapTaskContext = {
	getAppState: () => AppState;
	setAppState: (f: (prev: AppState) => AppState) => void;
};

const DEFAULT_TASK_TTL_MS = 30 * 60 * 1000; // 30 min
const DEFAULT_REAPER_INTERVAL_MS = 60 * 1000; // scan every 60s

let reaperTimer: ReturnType<typeof setInterval> | null = null;
let cleanupRegistered = false;
let killCleanupRegistered = false;

// 注入的 store 访问器 (REPL mount 时注入)。stopTask 需要 StopTaskContext。
let injectedGetAppState: (() => AppState) | null = null;
let injectedSetAppState:
	| ((f: (prev: AppState) => AppState) => void)
	| null = null;

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

// 周期扫描: 找出 running 且 startTime 距今 > TTL 的任务, stopTask reap。
// terminalStatuses 与 stopTask.killAllActive 一致 (stopTask 内部再校验 running)。
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

// 启动 reaper。REPL mount 时调一次, 注入 store 访问器。env off → no-op。
export function startTaskReaper(accessors: {
	getAppState: () => AppState;
	setAppState: (f: (prev: AppState) => AppState) => void;
}): () => void {
	injectedGetAppState = accessors.getAppState;
	injectedSetAppState = accessors.setAppState;
	// audit 0905 P0-A (zombie leak): 进程退出时 kill 所有 running 后台 task。
	// 旧实现: gracefulShutdown 只跑 runCleanupFunctions, 各 task 自己的 registerCleanup
	// 仅从 state 删条目 (setAppState delete), 不调 taskImpl.kill → 子进程被 init 收养
	// 成 zombie, 永占 MLX 内存/FD/worktree 锁。此 cleanup 走 killAllActive 真实 kill 路径。
	// 不受 FUSION_CODE_TASK_REAPER_ENABLED 门控 (reaper 周期扫描是可选优化; 退出 kill 是
	// 必需清理)。byte-safe: 无注入 accessor (headless/-p, 无 task) 或无 running task → no-op。
	// FUSION_CODE_TASK_KILL_ON_SHUTDOWN=0 可显式禁用 (兼容旧无 kill 行为)。
	if (!killCleanupRegistered) {
		killCleanupRegistered = true;
		registerCleanup(async () => {
			// default-on: killAllActive only acts when accessors + running tasks exist.
			// FUSION_CODE_TASK_KILL_ON_SHUTDOWN=0 显式禁用 (兼容旧无 kill 行为)。
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
