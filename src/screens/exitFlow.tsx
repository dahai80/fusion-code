// audit 1.1.1 slice #33: handleExit useCallback body extracted (INLINE-ASYNC-HELPER).
// REPL() exit flow, 3 branches: bg-session detach / worktree ExitFlow / exit.tsx modal.
// Closure deps passed via ctx (2 setters + 2 state), imported helpers/components imported directly, byte-equivalent behavior.
// Generates ExitFlow JSX → .tsx + React + ExitFlow import. Returns void (void call inside useCallback).
// deps [] (original useCallback deps empty) → ctx only passes stable setters/state, no stale closure risk.

import { feature } from "bun:bundle";
import { spawnSync } from "node:child_process";
import exit from "../commands/exit/index.js";
import { ExitFlow } from "../components/ExitFlow.js";
import { isBgSession } from "../utils/concurrentSessions.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

export type ExitFlowCtx = {
	setExitFlow: (node: React.ReactNode) => void;
	setIsExiting: (v: boolean) => void;
};

// ExitFlow cancel/done callbacks inlined (the original handleExit touches setters directly, keeping byte equivalence).
// exit command lazy-load: exit.load() → mod.call(() => {}) → setExitFlow(result).
// call() returning null = bg session detach did not kill the process → reset isExiting.
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
