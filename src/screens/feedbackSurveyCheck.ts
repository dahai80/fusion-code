// audit 1.1.1 slice #50: feedback survey inline handleSelect 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#48)。
// REPL() feedbackSurvey useMemo 内联 handleSelect: 重置 didAutoRunIssueRef → 调 original.handleSelect 取 showedTranscriptPrompt →
// selected="bad" 且未弹 transcript prompt 且 shouldAutoRunIssue → setAutoRunIssueReason("feedback_survey_bad") + didAutoRunIssueRef=true (触发后续 auto-run /issue)。
// 原 inline callback。feedbackSurveyOriginal (useFeedbackSurvey 返回值, deps 触发器) + didAutoRunIssueRef (ref) + setAutoRunIssueReason (useState setter) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useMemo() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 inline handleSelect factory 移出。
// shouldAutoRunIssue (utils/autoRunIssue) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 单用, 提取后 REPL import 移除)。
// 无 JSX → .ts。返新的 handleSelect fn (REPL 薄壳 useMemo spread 进对象)。
// deps [feedbackSurveyOriginal] 不变 (didAutoRunIssueRef ref + setAutoRunIssueReason setter 稳定引用, 省略合法, 与原一致)。

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AutoRunIssueReason } from "../utils/autoRunIssue.js";
import { shouldAutoRunIssue } from "../utils/autoRunIssue.js";

type FeedbackSurveyOriginal = {
	handleSelect: (selected: "dismissed" | "bad" | "fine" | "good") => boolean;
};

type FeedbackSurveyCheckCtx = {
	feedbackSurveyOriginal: FeedbackSurveyOriginal;
	didAutoRunIssueRef: MutableRefObject<boolean>;
	setAutoRunIssueReason: Dispatch<SetStateAction<AutoRunIssueReason | null>>;
};

// REPL 保留 useMemo 薄壳:
//   const feedbackSurvey = useMemo(
//     () => ({ ...feedbackSurveyOriginal, handleSelect: createFeedbackSurveyHandleSelect({ feedbackSurveyOriginal, didAutoRunIssueRef, setAutoRunIssueReason }) }),
//     [feedbackSurveyOriginal],
//   );
export function createFeedbackSurveyHandleSelect(
	ctx: FeedbackSurveyCheckCtx,
): (selected: "dismissed" | "bad" | "fine" | "good") => void {
	return (selected: "dismissed" | "bad" | "fine" | "good") => {
		// Reset the ref when a new survey response comes in
		ctx.didAutoRunIssueRef.current = false;
		const showedTranscriptPrompt =
			ctx.feedbackSurveyOriginal.handleSelect(selected);
		// Auto-run /issue for "bad" if transcript prompt wasn't shown
		if (
			selected === "bad" &&
			!showedTranscriptPrompt &&
			shouldAutoRunIssue("feedback_survey_bad")
		) {
			ctx.setAutoRunIssueReason("feedback_survey_bad");
			ctx.didAutoRunIssueRef.current = true;
		}
	};
}
