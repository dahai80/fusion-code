// audit 1.1.1: pure routing helper extracted from REPL.tsx handleIncomingPrompt.
// Behavior-equivalent to REPL.tsx:4764-4797. No React hooks, no JSX, no await.
// 3 steps: (1) queryGuard.isActive intercepts (reject if a query is running);
//   (2) getCommandQueue() checks for queued prompt/bash (user input has priority over system messages),
//       reads the module-level store to avoid stale closures (callback deps do not include queue);
//   (3) createAbortController + setAbortController + createUserMessage + void onQuery to start the query.
// Returns boolean: true=submitted, false=intercepted.
// ctx carries REPL closure dependencies (queryGuard + setAbortController + onQuery + mainLoopModel),
//   the helper holds no React state. getCommandQueue/createAbortController/createUserMessage are standalone module imports.
import type { Dispatch, SetStateAction } from "react";
import type { Message as MessageType } from "../types/message.js";
import type { EffortValue } from "../utils/effort.js";
import { getCommandQueue } from "../utils/messageQueueManager.js";
import { createAbortController } from "./abortController.js";
import { createUserMessage } from "./messages.js";
import type { QueryGuard } from "./QueryGuard.js";

type OnQueryFn = (
	newMessages: MessageType[],
	abortController: AbortController,
	shouldQuery: boolean,
	additionalAllowedTools: string[],
	mainLoopModelParam: string,
	onBeforeQueryCallback?: (
		input: string,
		newMessages: MessageType[],
	) => Promise<boolean>,
	input?: string,
	effort?: EffortValue,
) => Promise<void>;

type IncomingPromptCtx = {
	queryGuard: QueryGuard;
	setAbortController: Dispatch<SetStateAction<AbortController | null>>;
	onQuery: OnQueryFn;
	mainLoopModel: string;
};

// REPL keeps a thin useCallback wrapper:
//   const handleIncomingPrompt = useCallback(
//     (content, options?) => submitIncomingPrompt(content, options, { queryGuard, setAbortController, onQuery, mainLoopModel }),
//     [onQuery, mainLoopModel, store],
//   );
export function submitIncomingPrompt(
	content: string,
	options: { isMeta?: boolean } | undefined,
	ctx: IncomingPromptCtx,
): boolean {
	if (ctx.queryGuard.isActive) return false;

	// Defer to user-queued commands — user input always takes priority
	// over system messages (teammate messages, task list items, etc.)
	// Read from the module-level store at call time (not the render-time
	// snapshot) to avoid a stale closure — this callback's deps don't
	// include the queue.
	if (
		getCommandQueue().some(
			(cmd) => cmd.mode === "prompt" || cmd.mode === "bash",
		)
	) {
		return false;
	}
	const newAbortController = createAbortController();
	ctx.setAbortController(newAbortController);

	// Create a user message with the formatted content (includes XML wrapper)
	const userMessage = createUserMessage({
		content,
		isMeta: options?.isMeta ? true : undefined,
	});
	void ctx.onQuery(
		[userMessage],
		newAbortController,
		true,
		[],
		ctx.mainLoopModel,
	);
	return true;
}
