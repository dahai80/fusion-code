// audit 1.1.1 slice #70: resume file-history restore sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #10)。
// resume() useCallback body 子块 (REPL L1906-1910, 5-LOC): restoreSessionStateFromLog(log, setAppState)
// [从 resumed conversation 恢复 file history + attribution state] +
// if (log.fileHistorySnapshots) void copyFileHistoryForResume(log) [有快照则复制 file history 到新会话]。
// slice #61-#69 兄弟模式: resume useCallback 子块切出, resume-local 变量 (log) + REPL state (setAppState) 经 ctx 传入, 行为字节等价。
// restoreSessionStateFromLog (sessionRestore import) + copyFileHistoryForResume (fileHistory import) 直接 import
// (非 REPL state, per imported-helpers-directly rule; copyFileHistoryForResume REPL sole-user → 此 slice 后 REPL import 移除,
//  FileHistorySnapshot/FileHistoryState 仍 REPL 多用, 保留)。
// restoreSessionStateFromLog 形参类型 ResumeResult (sessionRestore 内部非导出类型) — REPL 调用点传 log: LogOption 字节等价
// (LogOption 结构满足 ResumeResult, 现有编译通过); 此 helper 透传 log: LogOption, 不导出内部类型 (ReturnType 规则同源)。
// 辅助返 void (restoreSessionStateFromLog void + void fire-and-forget copyFileHistoryForResume)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 10 块 (file-history restore)。

import type { LogOption } from "../types/logs.js";
import { copyFileHistoryForResume } from "../utils/fileHistory.js";
import type { SetAppState } from "../utils/messageQueueManager.js";
import { restoreSessionStateFromLog } from "../utils/sessionRestore.js";

type ResumeFileHistoryRestoreCtx = {
	log: LogOption;
	setAppState: SetAppState;
};

export function restoreResumeFileHistory(
	ctx: ResumeFileHistoryRestoreCtx,
): void {
	restoreSessionStateFromLog(ctx.log, ctx.setAppState);
	if (ctx.log.fileHistorySnapshots) {
		void copyFileHistoryForResume(ctx.log);
	}
}
