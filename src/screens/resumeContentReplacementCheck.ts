// audit 1.1.1 slice #61: resume content-replacement reconstruct sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume-chunked-extraction #1)。
// resume() useCallback body 子块 (REPL L2071-2077): 已读 feature flag 后 ref.current 为真 + entrypoint 非 fork →
// reconstructContentReplacementState(messages, log.contentReplacements ?? []) 重写 ref.current, 使 resume 后新替换写入 resumed session 目录。
// slice #43/#60 兄弟模式: 小内聚子块从大 useCallback 中切出, resume-local 变量经 ctx 传入 (闭包捕获), 行为字节等价。
// contentReplacementStateRef (REPL useState ref 对象 L1653, {current: ContentReplacementState}) + entrypoint (resume 参数 ResumeEntrypoint) +
// messages (resume-local MessageType[], deserializeMessages 返回) + contentReplacements (log.contentReplacements ?? [] 的已展开值, ContentReplacementRecord[]) 经 ctx 传入。
// reconstructContentReplacementState (utils/toolResultStorage) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用 L417, 保留 REPL import)。
// 辅助返 void (直接 mutate ref.current, 与原一致)。无 JSX → .ts。无 deps (resume body 内调用, 非 hook)。
// 注: 此为 resume 多会话切块提取的第 1 块 (4 块中最小+最少依赖, 1 ref + 3 resume-local 值)。后续 #62+ 提取 1876-1906/1950-1970/1980-2002。

import type { ResumeEntrypoint } from "../commands.js";
import type { Message as MessageType } from "../types/message.js";
import type {
	ContentReplacementRecord,
	ContentReplacementState,
} from "../utils/toolResultStorage.js";
import { reconstructContentReplacementState } from "../utils/toolResultStorage.js";

type ResumeContentReplacementCtx = {
	contentReplacementStateRef: { current: ContentReplacementState };
	entrypoint: ResumeEntrypoint;
	messages: MessageType[];
	contentReplacements: ContentReplacementRecord[];
};

// REPL resume() 保留薄壳:
//   if (contentReplacementStateRef.current && entrypoint !== "fork") {
//     reconstructResumeContentReplacement({ contentReplacementStateRef, entrypoint, messages, contentReplacements: log.contentReplacements ?? [] });
//   }
export function reconstructResumeContentReplacement(
	ctx: ResumeContentReplacementCtx,
): void {
	ctx.contentReplacementStateRef.current = reconstructContentReplacementState(
		ctx.messages,
		ctx.contentReplacements,
	);
}
