// audit 1.1.1 slice #66: resume metadata-clear + haiku-reset sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #6)。
// resume() useCallback body 子块 (REPL L1973-1979, 7-LOC): clearSessionMetadata() [清当前会话元数据, 便于 exit 时 reAppendSessionMetadata 重追加]
// + restoreSessionMetadata(log) [按 log 恢复目标会话元数据, 仅 set-if-truthy] +
// haikuTitleAttemptedRef.current = true [标记已尝试 Haiku title, resume 不应再从中途 context 重命名] +
// setHaikuTitle(undefined) [清前一会话 Haiku title, 不延续]。
// slice #61-#65 兄弟模式: resume useCallback 子块切出, resume-local 变量 (log) + REPL state ref/setter
// (haikuTitleAttemptedRef/setHaikuTitle) 经 ctx 传入, 行为字节等价。
// clearSessionMetadata/restoreSessionMetadata (sessionStorage import 块) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import)。
// haikuTitleAttemptedRef 为 useRef<boolean> ref OBJECT → 稳定, 经 ctx 传入 (非 deps)。setHaikuTitle 为 useState setter → 经 ctx 传入。
// 辅助返 void (纯同步 setter 链)。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 6 块 (metadata-clear + haiku-reset, 纯同步最少依赖)。

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { LogOption } from "../types/logs.js";
import {
	clearSessionMetadata,
	restoreSessionMetadata,
} from "../utils/sessionStorage.js";

type ResumeMetadataResetCtx = {
	log: LogOption;
	haikuTitleAttemptedRef: MutableRefObject<boolean>;
	setHaikuTitle: Dispatch<SetStateAction<string | undefined>>;
};

export function resetResumeMetadata(ctx: ResumeMetadataResetCtx): void {
	clearSessionMetadata();
	restoreSessionMetadata(ctx.log);
	ctx.haikuTitleAttemptedRef.current = true;
	ctx.setHaikuTitle(undefined);
}
