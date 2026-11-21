// audit 1.1.1: haiku title extraction pulled out of REPL.tsx onQueryImpl (PURE-ROUTING SUB-BLOCK class, like slice #25 apiMetricsCapture).
// Behavior-equivalent to REPL.tsx:3101-3138. No React hooks, no JSX. Fire-and-forget void generateSessionTitle.
// Only when !titleDisabled && !sessionTitle && !agentTitle && !haikuTitleAttemptedRef.current:
//   (1) find first real user message (type==="user" && !isMeta);
//   (2) getContentText extracts the text;
//   (3) skip synthetic breadcrumbs (leading local-command-stdout/command-message/command-name/bash-input tags);
//   (4) haikuTitleAttemptedRef.current = true (one-shot ref preventing SessionStart/attachment messages from stretching messages);
//   (5) void generateSessionTitle(text, signal).then: title?setHaikuTitle(title):setHaikuTitle(extractFallbackTitle); reject → setHaikuTitle(extractFallbackTitle).
// ctx carries REPL closure deps (titleDisabled + sessionTitle + agentTitle + haikuTitleAttemptedRef + setHaikuTitle);
//   the helper holds no React state. getContentText/generateSessionTitle/extractFallbackTitle/tags are standalone module imports.
import {
	BASH_INPUT_TAG,
	COMMAND_MESSAGE_TAG,
	COMMAND_NAME_TAG,
	LOCAL_COMMAND_STDOUT_TAG,
} from "../constants/xml.js";
import type { Message as MessageType } from "../types/message.js";
import { getContentText } from "./messages.js";
import { extractFallbackTitle, generateSessionTitle } from "./sessionTitle.js";

type HaikuTitleCtx = {
	titleDisabled: boolean | undefined;
	sessionTitle: string | undefined;
	agentTitle: string | undefined;
	haikuTitleAttemptedRef: { current: boolean };
	setHaikuTitle: (title: string | undefined) => void;
};

// REPL keeps a thin call: maybeExtractHaikuTitle(newMessages, { titleDisabled, sessionTitle, agentTitle, haikuTitleAttemptedRef, setHaikuTitle });
// wrapped in the original if-chain outer check (the helper re-checks internally, double insurance).
export function maybeExtractHaikuTitle(
	newMessages: MessageType[],
	ctx: HaikuTitleCtx,
): void {
	if (
		ctx.titleDisabled ||
		ctx.sessionTitle ||
		ctx.agentTitle ||
		ctx.haikuTitleAttemptedRef.current
	) {
		return;
	}
	const firstUserMessage = newMessages.find(
		(m) => m.type === "user" && !m.isMeta,
	);
	const text =
		firstUserMessage?.type === "user"
			? getContentText(firstUserMessage.message.content)
			: null;
	// Skip synthetic breadcrumbs — slash-command output, prompt-skill
	// expansions (/commit → <command-message>), local-command headers
	// (/help → <command-name>), and bash-mode (!cmd → <bash-input>).
	// None of these are the user's topic; wait for real prose.
	if (
		text &&
		!text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}>`) &&
		!text.startsWith(`<${COMMAND_MESSAGE_TAG}>`) &&
		!text.startsWith(`<${COMMAND_NAME_TAG}>`) &&
		!text.startsWith(`<${BASH_INPUT_TAG}>`)
	) {
		ctx.haikuTitleAttemptedRef.current = true;
		void generateSessionTitle(text, new AbortController().signal).then(
			(title) => {
				if (title) ctx.setHaikuTitle(title);
				else {
					ctx.setHaikuTitle(extractFallbackTitle(text));
				}
			},
			() => {
				ctx.setHaikuTitle(extractFallbackTitle(text));
			},
		);
	}
}
