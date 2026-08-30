// audit 1.1.1 slice #65: resume worktree-restore if/else sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #5)。
// resume() useCallback body 子块 (REPL L1990-2005, 16-LOC): entrypoint !== "fork" 分支 —
// exitRestoredWorktree() [退出先前 /resume 进入的 worktree] + restoreWorktreeForResume(log.worktreeSession)
// [cd 回此会话所在 worktree] + adoptResumedSessionFile() [采纳 resume 会话文件] +
// void restoreRemoteAgentTasks({abortController, getAppState, setAppState}) [恢复 remote agent tasks]；
// else fork 分支 — getCurrentWorktreeSession() → ws ? saveWorktreeState(ws) [fork: 同 /clear 再持久化 worktree 状态]。
// slice #61-#64 兄弟模式: resume useCallback 子块切出, resume-local 变量 (entrypoint, log.worktreeSession) +
// REPL-local fn (restoreRemoteAgentTasks no-op stub L426) 经 ctx 传入, 行为字节等价。
// exitRestoredWorktree/restoreWorktreeForResume/adoptResumedSessionFile/saveWorktreeState (sessionStorage import 块) +
// getCurrentWorktreeSession (utils/worktree) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import)。
// restoreRemoteAgentTasks 为 REPL-local no-op stub (非 import) → 经 ctx 传入, 类型窄化为调用点 object shape。
// 辅助返 void (两分支均 void)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 5 块 (worktree 恢复 if/else, 含 fork 分支)。

import type { AppStateStore } from "../state/AppStateStore.js";
import type { PersistedWorktreeSession } from "../types/logs.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import {
	exitRestoredWorktree,
	restoreWorktreeForResume,
} from "../utils/sessionRestore.js";
import {
	adoptResumedSessionFile,
	saveWorktreeState,
} from "../utils/sessionStorage.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

type ResumeRemoteAgentTasksFn = (opts: {
	abortController: AbortController;
	getAppState: () => unknown;
	setAppState: SetAppState;
}) => Promise<void>;

type ResumeWorktreeRestoreCtx = {
	entrypoint: string;
	worktreeSession: PersistedWorktreeSession | null | undefined;
	restoreRemoteAgentTasks: ResumeRemoteAgentTasksFn;
	store: AppStateStore;
	setAppState: SetAppState;
};

export function restoreResumeWorktree(ctx: ResumeWorktreeRestoreCtx): void {
	if (ctx.entrypoint !== "fork") {
		exitRestoredWorktree();
		restoreWorktreeForResume(ctx.worktreeSession);
		adoptResumedSessionFile();
		void ctx.restoreRemoteAgentTasks({
			abortController: new AbortController(),
			getAppState: () => ctx.store.getState(),
			setAppState: ctx.setAppState,
		});
	} else {
		const ws = getCurrentWorktreeSession();
		if (ws) saveWorktreeState(ws);
	}
}
