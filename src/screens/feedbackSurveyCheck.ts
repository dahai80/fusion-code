// audit 1.1.1 slice #50: feedback survey inline handleSelect extracted (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#48).
// REPL() feedbackSurvey useMemo inline handleSelect: reset didAutoRunIssueRef → call original.handleSelect for showedTranscriptPrompt →
// selected="bad" and no transcript prompt shown and shouldAutoRunIssue → setAutoRunIssueReason("feedback_survey_bad") + didAutoRunIssueRef=true (triggers the later auto-run /issue).
// Original inline callback. feedbackSurveyOriginal (useFeedbackSurvey return value, deps trigger) + didAutoRunIssueRef (ref) + setAutoRunIssueReason (useState setter) passed via ctx (closure capture), byte-equivalent behavior.
// The useMemo() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the inline handleSelect factory moves out.
// shouldAutoRunIssue (utils/autoRunIssue) imported directly (not REPL state, per imported-helpers-directly rule; single use in REPL, REPL import removed after extraction).
// No JSX → .ts. Returns the new handleSelect fn (REPL thin shell spreads it into the useMemo object).
// deps [feedbackSurveyOriginal] unchanged (didAutoRunIssueRef ref + setAutoRunIssueReason setter are stable refs, safe to omit, matching the original).

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

// REPL keeps the useMemo thin shell:
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
