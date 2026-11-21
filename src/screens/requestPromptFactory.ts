// audit 1.1.1 slice #41: requestPrompt useCallback body extracted (PURE-ROUTING-CALLBACK, like #24 submitIncomingPrompt).
// REPL() curried Promise-queue factory: (title, toolInputSummary?) => (request) => new Promise, resolve/reject appended as a promptQueue item.
// Original useCallback body. setPromptQueue passed via ctx (closure capture, useState setter stable ref, deps []), byte-equivalent behavior.
// PromptRequest/PromptResponse (types/hooks.js) imported directly (types are not REPL state, per imported-helpers-directly rule).
// No JSX / no hook → .ts. Returns the curried factory (REPL useCallback thin-shell pass-through, deps [] unchanged).
// setPromptQueue is a useState setter, stable ref, safe to omit, deps [] matches the original.

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

// REPL keeps the useCallback thin shell:
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
