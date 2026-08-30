// audit 1.1.1 slice #60: SandboxManager 初始化 if-block 外移 (PURE-ROUTING-SUB-BLOCK render-body variant, like #43)。
// REPL() 渲染期: SandboxManager.isSandboxingEnabled() 为真 → SandboxManager.initialize(sandboxAskCallback) 异步初始化,
// 失败则 stderr 写错误 + gracefulShutdownSync(1, "other") 拒绝启动。为 slice #43 (sandboxUnavailableCheck) 的兄弟块,
// 共用 SandboxManager + gracefulShutdownSync + stderr 模式。原 top-level render body (非 useEffect, 每 render 执行, 与原一致)。
// SandboxManager (src/utils/sandbox/sandbox-adapter) + errorMessage (utils/errors) + gracefulShutdownSync (utils/gracefulShutdown) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import)。
// sandboxAskCallback (REPL-local useCallback L2310, 闭包捕获 store/setAppState/setSandboxPermissionRequestQueue/sandboxBridgeCleanupRef) 经 ctx 传入。
// 辅助返 void (REPL 渲染期薄壳透传, 非 hook, 无 cleanup)。无 JSX → .ts。无 deps (render body, 非 hook)。

import { SandboxManager } from "src/utils/sandbox/sandbox-adapter.js";
import { errorMessage } from "../utils/errors.js";
import { gracefulShutdownSync } from "../utils/gracefulShutdown.js";
import type { SandboxAskCallback } from "../utils/sandbox/sandbox-adapter.js";

type SandboxInitCtx = {
	sandboxAskCallback: SandboxAskCallback;
};

// REPL 保留 plain 薄壳 (渲染期每 render 调用, 与原 top-level if-block 语义等价):
//   if (SandboxManager.isSandboxingEnabled()) { maybeInitSandbox({ sandboxAskCallback }); }
// 注: 原 if 守卫在 REPL 保留还是 helper 内保留 — 选 helper 内保留 (守卫属初始化逻辑一部分, 移出更内聚)。
// 但为最小改动 + 字节等价, REPL 薄壳仍保留 if (SandboxManager.isSandboxingEnabled()) 守卫, helper 只做 init+catch。
export function maybeInitSandbox(ctx: SandboxInitCtx): void {
	SandboxManager.initialize(ctx.sandboxAskCallback).catch((err: unknown) => {
		// Initialization/validation failed - display error and exit
		process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
		gracefulShutdownSync(1, "other");
	});
}
