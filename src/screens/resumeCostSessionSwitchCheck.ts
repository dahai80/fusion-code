// audit 1.1.1 slice #64: resume cost-save + session-switch sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #4 final)。
// resume() useCallback body 子块 (REPL L1957-1979, 23-LOC): targetSessionCosts = getStoredSessionCosts(sessionId) [读目标会话成本, saveCurrentSessionCosts 覆写前先读]
// → saveCurrentSessionCosts() [存当前会话成本] → resetCostState() [清空成本状态] →
// switchSession(asSessionId(sessionId), log.fullPath ? dirname(log.fullPath) : null) [原子切会话 id+项目目录] →
// await import("../utils/asciicast.js").renameRecordingForSession() [重命名 asciicast 录制] → await resetSessionFilePointer() [重置会话文件指针]。
// slice #61/#62/#63 兄弟模式: 大 useCallback 子块切出, resume-local 变量 (sessionId, log.fullPath) 经 ctx 传入,
// 全部副作用调用移入 helper。辅助返 targetSessionCosts (StoredCostState|undefined) — REPL 保留 const 接收,
// 因后续 L2032 `if (targetSessionCosts) setCostStateForRestore(targetSessionCosts)` 消费此返回值 (73 行后)。
// 返回值经 helper 返回 + REPL const 接收, 线程化保持字节等价 (return-value-threading 模式, 第 1 例)。
// getStoredSessionCosts/saveCurrentSessionCosts/resetCostState (cost-tracker) + switchSession (bootstrap/state) +
// resetSessionFilePointer (utils/sessionStorage) + asSessionId (types/ids) + dirname (path) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import)。
// StoredCostState 为 cost-tracker 内部非导出类型 → 用 ReturnType<typeof getStoredSessionCosts> 派生 (零文件改动, 类型安全)。
// await import("../utils/asciicast.js") 动态导入保留在 helper 内 (原写法)。
// 辅助返 Promise<StoredCostState | undefined> (内含 await, REPL await 调用)。无 JSX → .ts。
// 注: 此为 resume 多会话切块提取的第 4 块 (最后一块, 含 return-value-threading)。resume() 4 块全提取完毕。

import type { UUID } from "crypto";
import { dirname } from "path";
import { switchSession } from "../bootstrap/state.js";
import {
	getStoredSessionCosts,
	resetCostState,
	saveCurrentSessionCosts,
} from "../cost-tracker.js";
import { asSessionId } from "../types/ids.js";
import { resetSessionFilePointer } from "../utils/sessionStorage.js";

type ResumeCostSessionSwitchCtx = {
	sessionId: UUID;
	fullPath: string | undefined;
};

// REPL resume() 保留薄壳 (return-value-threading):
//   const targetSessionCosts = await saveAndSwitchResumeSession({
//     sessionId,
//     fullPath: log.fullPath,
//   });
//   ... (后续 L2032: if (targetSessionCosts) setCostStateForRestore(targetSessionCosts); 保持原样)
export async function saveAndSwitchResumeSession(
	ctx: ResumeCostSessionSwitchCtx,
): Promise<ReturnType<typeof getStoredSessionCosts>> {
	const targetSessionCosts = getStoredSessionCosts(ctx.sessionId);
	saveCurrentSessionCosts();
	resetCostState();
	switchSession(
		asSessionId(ctx.sessionId),
		ctx.fullPath ? dirname(ctx.fullPath) : null,
	);
	const { renameRecordingForSession } = await import("../utils/asciicast.js");
	await renameRecordingForSession();
	await resetSessionFilePointer();
	return targetSessionCosts;
}
