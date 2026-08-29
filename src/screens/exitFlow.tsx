// audit 1.1.1 slice #33: handleExit useCallback body 外移 (INLINE-ASYNC-HELPER).
// REPL() exit 流程 3 分支: bg-session detach / worktree ExitFlow / exit.tsx modal。
// 闭包依赖经 ctx 传入 (2 setter + 2 state), 导入型 helper/组件直接 import, 行为字节等价。
// 生成 ExitFlow JSX → .tsx + React + ExitFlow import。void 返回 (useCallback 内 void 调用)。
// deps [] (原 useCallback deps 为空) → ctx 仅传稳定 setter/state, 无 stale 闭包风险。

import { feature } from "bun:bundle";
import { spawnSync } from "child_process";
import exit from "../commands/exit/index.js";
import { ExitFlow } from "../components/ExitFlow.js";
import { isBgSession } from "../utils/concurrentSessions.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

export type ExitFlowCtx = {
	setExitFlow: (node: React.ReactNode) => void;
	setIsExiting: (v: boolean) => void;
};

// ExitFlow 取消/完成回调内联 (原始 handleExit 直接触及 setter, 保持字节等价)。
// exit 命令 lazy-load: exit.load() → mod.call(() => {}) → setExitFlow(result)。
// call() 返回 null = bg session detach 未杀进程 → 复位 isExiting。
export async function runExitFlow(ctx: ExitFlowCtx): Promise<void> {
	ctx.setIsExiting(true);
	// In bg sessions, always detach instead of kill — even when a worktree is
	// active. Without this guard, the worktree branch below short-circuits into
	// ExitFlow (which calls gracefulShutdown) before exit.tsx is ever loaded.
	if (feature("BG_SESSIONS") && isBgSession()) {
		spawnSync("tmux", ["detach-client"], {
			stdio: "ignore",
		});
		ctx.setIsExiting(false);
		return;
	}
	const showWorktree = getCurrentWorktreeSession() !== null;
	if (showWorktree) {
		ctx.setExitFlow(
			<ExitFlow
				showWorktree
				onDone={() => {}}
				onCancel={() => {
					ctx.setExitFlow(null);
					ctx.setIsExiting(false);
				}}
			/>,
		);
		return;
	}
	const exitMod = await exit.load();
	const exitFlowResult = await exitMod.call(() => {});
	ctx.setExitFlow(exitFlowResult);
	// If call() returned without killing the process (bg session detach),
	// clear isExiting so the UI is usable on reattach. No-op on the normal
	// path — gracefulShutdown's process.exit() means we never get here.
	if (exitFlowResult === null) {
		ctx.setIsExiting(false);
	}
}
