// audit 1.1.1 slice #41: requestPrompt useCallback body 外移 (PURE-ROUTING-CALLBACK, like #24 submitIncomingPrompt)。
// REPL() curried Promise-queue factory: (title, toolInputSummary?) => (request) => new Promise, resolve/reject 入 promptQueue item append。
// 原 useCallback body。setPromptQueue 经 ctx 传入 (闭包捕获, useState setter 稳定引用 deps []), 行为字节等价。
// PromptRequest/PromptResponse (types/hooks.js) 直接 import (类型非 REPL state, per imported-helpers-directly rule)。
// 无 JSX/无 hook → .ts。返 curried factory (REPL useCallback 薄壳透传, deps [] 不变)。
// setPromptQueue 是 useState setter, 稳定引用, 省略合法, deps [] 与原一致。

import type { PromptRequest, PromptResponse } from "../types/hooks.js";

type PromptQueueItem = {
	request: PromptRequest;
	title: string;
	toolInputSummary?: string | null;
	resolve: (response: PromptResponse) => void;
	reject: (error: Error) => void;
};

type RequestPromptFactoryCtx = {
	setPromptQueue: (
		updater: (prev: PromptQueueItem[]) => PromptQueueItem[],
	) => void;
};

// REPL 保留 useCallback 薄壳:
//   const requestPrompt = useCallback(
//     () => createRequestPrompt({ setPromptQueue }),
//     [],
//   );
export function createRequestPrompt(
	ctx: RequestPromptFactoryCtx,
): (
	title: string,
	toolInputSummary?: string | null,
) => (request: PromptRequest) => Promise<PromptResponse> {
	return (title: string, toolInputSummary?: string | null) =>
		(request: PromptRequest): Promise<PromptResponse> =>
			new Promise<PromptResponse>((resolve, reject) => {
				ctx.setPromptQueue((prev) => [
					...prev,
					{
						request,
						title,
						toolInputSummary,
						resolve,
						reject,
					},
				]);
			});
}
