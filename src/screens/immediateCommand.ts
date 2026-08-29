// audit 1.1.1 slice #32: executeImmediateCommand inline-async 外移 (INLINE-ASYNC-IIFE).
// onSubmit 内 immediate-command 分支: onDone 回调 + context 构建 + mod.call + setToolJSX 路由。
// 闭包依赖经 ctx 传入 (setters/refs/funcs/command), 导入型 helper 直接 import, 行为字节等价。
// 无 JSX 生成 (jsx 返回值仅路由到 setToolJSX), 无 hook, void 返回 (onSubmit 内 void 调用)。

import type { MutableRefObject, SetStateAction } from "react";
import { type CommandResultDisplay, getCommandName } from "../commands.js";
import { LOCAL_COMMAND_STDOUT_TAG } from "../constants/xml.js";
import type { Notification } from "../context/notifications.js";
import type { CommandBase, LocalJSXCommand } from "../types/command.js";
import type { Message as MessageType } from "../types/message.js";
import { createAbortController } from "../utils/abortController.js";
import type { PastedContent } from "../utils/config.js";
import { isFullscreenEnvEnabled } from "../utils/fullscreen.js";
import type { PromptInputHelpers } from "../utils/handlePromptSubmit.js";
import {
	createCommandInputMessage,
	createUserMessage,
	formatCommandInputTags,
} from "../utils/messages.js";
import type { ProcessUserInputContext } from "../utils/processUserInput/processUserInput.js";
import { escapeXml } from "../utils/xml.js";

type StashedPrompt =
	| {
			text: string;
			cursorOffset: number;
			pastedContents: Record<number, PastedContent>;
	  }
	| undefined;

type SetToolJsxFn = (args: {
	jsx: unknown;
	shouldHidePromptInput: boolean;
	clearLocalJSX?: boolean;
	isLocalJSXCommand?: boolean;
}) => void;

type SetMessagesFn = (action: SetStateAction<MessageType[]>) => void;

type GetToolUseContextFn = (
	messages: MessageType[],
	newMessages: MessageType[],
	abortController: AbortController,
	mainLoopModel: string,
) => ProcessUserInputContext;

export type RunImmediateCommandCtx = {
	matchingCommand: CommandBase & LocalJSXCommand;
	commandArgs: string;
	setToolJSX: SetToolJsxFn;
	addNotification: (content: Notification) => void;
	setMessages: SetMessagesFn;
	setInputValue: (v: string) => void;
	helpers: PromptInputHelpers;
	stashedPrompt: StashedPrompt;
	setPastedContents: (
		action: SetStateAction<Record<number, PastedContent>>,
	) => void;
	setStashedPrompt: (action: SetStateAction<StashedPrompt>) => void;
	getToolUseContext: GetToolUseContextFn;
	messagesRef: MutableRefObject<MessageType[]>;
	mainLoopModel: string;
};

export async function runImmediateCommand(
	ctx: RunImmediateCommandCtx,
): Promise<void> {
	let doneWasCalled = false;
	const onDone = (
		result?: string,
		doneOptions?: {
			display?: CommandResultDisplay;
			metaMessages?: string[];
		},
	): void => {
		doneWasCalled = true;
		ctx.setToolJSX({
			jsx: null,
			shouldHidePromptInput: false,
			clearLocalJSX: true,
		});
		const newMessages: MessageType[] = [];
		if (result && doneOptions?.display !== "skip") {
			ctx.addNotification({
				key: `immediate-${ctx.matchingCommand.name}`,
				text: result,
				priority: "immediate",
			});
			// In fullscreen the command just showed as a centered modal
			// pane — the notification above is enough feedback. Adding
			// "❯ /config" + "⎿ dismissed" to the transcript is clutter
			// (those messages are type:system subtype:local_command —
			// user-visible but NOT sent to the model, so skipping them
			// doesn't change model context). Outside fullscreen the
			// transcript entry stays so scrollback shows what ran.
			if (!isFullscreenEnvEnabled()) {
				newMessages.push(
					createCommandInputMessage(
						formatCommandInputTags(
							getCommandName(ctx.matchingCommand),
							ctx.commandArgs,
						),
					),
					createCommandInputMessage(
						`<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(result)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
					),
				);
			}
		}
		// Inject meta messages (model-visible, user-hidden) into the transcript
		if (doneOptions?.metaMessages?.length) {
			newMessages.push(
				...doneOptions.metaMessages.map((content) =>
					createUserMessage({
						content,
						isMeta: true,
					}),
				),
			);
		}
		if (newMessages.length) {
			ctx.setMessages((prev) => [...prev, ...newMessages]);
		}
		// Restore stashed prompt after local-jsx command completes.
		// The normal stash restoration path (below) is skipped because
		// local-jsx commands return early from onSubmit.
		if (ctx.stashedPrompt !== undefined) {
			ctx.setInputValue(ctx.stashedPrompt.text);
			ctx.helpers.setCursorOffset(ctx.stashedPrompt.cursorOffset);
			ctx.setPastedContents(ctx.stashedPrompt.pastedContents);
			ctx.setStashedPrompt(undefined);
		}
	};

	// Build context for the command (reuses existing getToolUseContext).
	// Read messages via ref to keep onSubmit stable across message
	// updates — matches the pattern at L2384/L2400/L2662 and avoids
	// pinning stale REPL render scopes in downstream closures.
	const context = ctx.getToolUseContext(
		ctx.messagesRef.current,
		[],
		createAbortController(),
		ctx.mainLoopModel,
	);
	const mod = await ctx.matchingCommand.load();
	const jsx = await mod.call(onDone, context, ctx.commandArgs);

	// Skip if onDone already fired — prevents stuck isLocalJSXCommand
	// (see processSlashCommand.tsx local-jsx case for full mechanism).
	if (jsx && !doneWasCalled) {
		// shouldHidePromptInput: false keeps Notifications mounted
		// so the onDone result isn't lost
		ctx.setToolJSX({
			jsx,
			shouldHidePromptInput: false,
			isLocalJSXCommand: true,
		});
	}
}
