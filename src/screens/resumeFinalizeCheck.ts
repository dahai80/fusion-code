// audit 1.1.1 slice #72: resume finalize UI-state + success-telemetry sub-block 外移 (PURE-ROUTING-SUB-BLOCK, resume chunked-extraction #12)。
// resume() useCallback body 子块 (REPL L1998-2007, 9-LOC): setMessages(() => messages) [重置消息为反序列化后的 resumed conversation,
//  callback 形式避免 stale state] + setToolJSX(null) [清除活跃 tool JSX overlay, 纯 null 与 applyToolJSXUpdate null 分支字节等价] +
// setInputValue("") [清除残留输入] + logEvent("tengu_session_resumed", {entrypoint, success:true, resume_duration_ms}) [成功遥测, 计时自 resumeStart]。
// slice #61-#71 兄弟模式: resume useCallback 子块切出, resume-local 变量 (messages, entrypoint, resumeStart) + REPL state (setMessages/setToolJSX/setInputValue) 经 ctx 传入, 行为字节等价。
// logEvent (analytics import) 直接 import (非 REPL state, per imported-helpers-directly rule; logEvent REPL 9 处共用, 保留 REPL import; AnalyticsMetadata type REPL 7 处共用, 保留)。
// resumeStart (resume try 外 body-local number, L1863) 经 ctx 传入 (helper 不持 resume 状态); catch 分支 logEvent(success:false) 留 REPL (与 try 结构耦合, 不用 resumeStart)。
// setMessages 形参 SetStateAction<MessageType[]> (REPL L1344 useCallback 签名, import from react); setToolJSX 形参 SetToolJSXArgs (setToolJSXWrapper 导出类型, null 合法);
// setInputValue 形参 string (REPL L1473 useCallback 签名)。
// 辅助返 void。无 JSX → .ts。
// 注: 此为 resume 切块提取的第 12 块 (finalize UI reset + success telemetry)。resume() 主体至此残: restoreReadFileState 1-call + loading-clear 3-setter trio +
// setCostStateForRestore guarded 1-call + try/catch 包络 (结构粘合, 留 REPL per thin-wrapper-skip rule)。

import type { SetStateAction } from "react";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	logEvent,
} from "src/services/analytics/index.js";
import type { ResumeEntrypoint } from "../commands.js";
import type { Message as MessageType } from "../types/message.js";
import type { SetToolJSXArgs } from "../utils/setToolJSXWrapper.js";

type SetMessagesFn = (action: SetStateAction<MessageType[]>) => void;
type SetToolJSXFn = (args: SetToolJSXArgs) => void;
type SetInputValueFn = (value: string) => void;

type ResumeFinalizeCtx = {
	messages: MessageType[];
	entrypoint: ResumeEntrypoint;
	resumeStart: number;
	setMessages: SetMessagesFn;
	setToolJSX: SetToolJSXFn;
	setInputValue: SetInputValueFn;
};

export function finalizeResume(ctx: ResumeFinalizeCtx): void {
	ctx.setMessages(() => ctx.messages);
	ctx.setToolJSX(null);
	ctx.setInputValue("");
	logEvent("tengu_session_resumed", {
		entrypoint:
			ctx.entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
		success: true,
		resume_duration_ms: Math.round(performance.now() - ctx.resumeStart),
	});
}
