// audit 1.1.1 slice #69: resume fork plan-copy if/else sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #9)。
// resume() useCallback body 子块 (REPL L1903-1910, 8-LOC): entrypoint === "fork" 分支 —
// void copyPlanForFork(log, asSessionId(sessionId)) [fork: 生成新 plan slug + 复制 plan 内容, 原/fork 不互覆];
// else — void copyPlanForResume(log, asSessionId(sessionId)) [普通 resume: 复用原会话 plan slug]。
// slice #61-#68 兄弟模式: resume useCallback 子块切出, resume-local 变量 (entrypoint, log, sessionId) 经 ctx 传入, 行为字节等价。
// copyPlanForFork/copyPlanForResume (plans.ts import 块) + asSessionId (types/ids) 直接 import
// (非 REPL state, per imported-helpers-directly rule; REPL 不再用 — 但 import-cleanup 后续 slice 处理, 此 slice 先保留 REPL import 视多处共用)。
// 辅助返 void (两分支均 fire-and-forget void)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 9 块 (fork plan copy if/else)。

import type { UUID } from "crypto";
import type { ResumeEntrypoint } from "../commands.js";
import { asSessionId } from "../types/ids.js";
import type { LogOption } from "../types/logs.js";
import { copyPlanForFork, copyPlanForResume } from "../utils/plans.js";

type ResumePlanCopyCtx = {
	entrypoint: ResumeEntrypoint;
	log: LogOption;
	sessionId: UUID;
};

export function copyResumePlan(ctx: ResumePlanCopyCtx): void {
	if (ctx.entrypoint === "fork") {
		void copyPlanForFork(ctx.log, asSessionId(ctx.sessionId));
	} else {
		void copyPlanForResume(ctx.log, asSessionId(ctx.sessionId));
	}
}
