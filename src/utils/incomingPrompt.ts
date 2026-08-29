// audit 1.1.1: 从 REPL.tsx handleIncomingPrompt 抽出的纯路由 helper。
// 行为等价 REPL.tsx:4764-4797。无 React hooks, 无 JSX, 无 await。
// 3 步: (1) queryGuard.isActive 拦截 (query 在跑则拒);
//   (2) getCommandQueue() 检查是否有排队 prompt/bash (用户输入优先级高于系统消息),
//       读 module-level store 避免过期闭包 (callback deps 不含 queue);
//   (3) createAbortController + setAbortController + createUserMessage + void onQuery 启动查询。
// 返回 boolean: true=已提交, false=被拦截。
// ctx 携带 REPL 闭包依赖 (queryGuard + setAbortController + onQuery + mainLoopModel),
//   helper 不持有 React state。getCommandQueue/createAbortController/createUserMessage 为独立 module import。
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

// REPL 保留薄包装 useCallback:
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
