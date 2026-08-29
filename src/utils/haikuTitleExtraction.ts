// audit 1.1.1: 从 REPL.tsx onQueryImpl haiku title 抽出 (PURE-ROUTING SUB-BLOCK class, 像 slice #25 apiMetricsCapture)。
// 行为等价 REPL.tsx:3101-3138。无 React hooks, 无 JSX。fire-and-forget void generateSessionTitle。
// 仅当 !titleDisabled && !sessionTitle && !agentTitle && !haikuTitleAttemptedRef.current 时:
//   (1) find first real user message (type==="user" && !isMeta);
//   (2) getContentText 提取文本;
//   (3) 跳过 synthetic breadcrumbs (local-command-stdout/command-message/command-name/bash-input tag 开头);
//   (4) haikuTitleAttemptedRef.current = true (one-shot ref 防 SessionStart/attachment 消息撑长 messages);
//   (5) void generateSessionTitle(text, signal).then: title?setHaikuTitle(title):setHaikuTitle(extractFallbackTitle); reject → setHaikuTitle(extractFallbackTitle)。
// ctx 携带 REPL 闭包依赖 (titleDisabled + sessionTitle + agentTitle + haikuTitleAttemptedRef + setHaikuTitle),
//   helper 不持有 React state。getContentText/generateSessionTitle/extractFallbackTitle/tags 为独立 module import。
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

// REPL 保留薄调用: maybeExtractHaikuTitle(newMessages, { titleDisabled, sessionTitle, agentTitle, haikuTitleAttemptedRef, setHaikuTitle });
// 包在原 if-chain 外层判断里 (helper 内部再判一次, 双保险)。
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
