// audit 1.1.1 slice #57: initialMessages restore useEffect body extracted (PURE-ROUTING-SUB-BLOCK effect-body variant, like #51/#54).
// REPL() mount-once useEffect: --resume-session / ResumeConversation passes the initialMessages props → restoreReadFileState restores read-file state + restoreRemoteAgentTasks restores remote agent tasks.
// Original useEffect body: guard (initialMessages && length > 0) → restoreReadFileState(initialMessages, getOriginalCwd()) + void restoreRemoteAgentTasks({abortController, getAppState, setAppState}).
// initialMessages (prop, deps trigger but omitted because mount-once — consistent with the original eslint-disable) + restoreReadFileState (REPL-local useCallback L2125 wrapper, closure-captures readFileState/bashTools) +
// restoreRemoteAgentTasks (REPL-local no-op stub L418, not imported) + store (useAppStateStore L787) + setAppState (useSetAppState L770) passed via ctx (closure capture), byte-equivalent behavior.
// The useEffect() hook stays as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out; helper returns void (no cleanup, not needed for mount-once).
// getOriginalCwd (bootstrap/state) imported directly (not REPL state, per imported-helpers-directly rule; used multiple times in REPL, REPL import kept, helper imports directly too).
// restoreRemoteAgentTasks is currently a no-op stub (RemoteAgentTask removed, cloud-only), but the object is still constructed (byte-equivalent, dead construction not removed just because it's a no-op).
// No JSX → .ts. Returns void. deps [] unchanged (mount-once, eslint-disable-next-line react-hooks/exhaustive-deps kept).

import { getOriginalCwd } from "../bootstrap/state.js";
import type { AppStateStore } from "../state/AppStateStore.js";
import type { Message as MessageType } from "../types/message.js";
import type { SetAppState } from "../utils/messageQueueManager.js";

type InitialMessagesRestoreCtx = {
	initialMessages: MessageType[] | undefined;
	restoreReadFileState: (messages: MessageType[], cwd: string) => void;
	restoreRemoteAgentTasks: (opts: {
		abortController: AbortController;
		getAppState: () => unknown;
		setAppState: SetAppState;
	}) => Promise<void>;
	store: AppStateStore;
	setAppState: SetAppState;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => {
//     restoreInitialMessages({ initialMessages, restoreReadFileState, restoreRemoteAgentTasks, store, setAppState });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);
export function restoreInitialMessages(ctx: InitialMessagesRestoreCtx): void {
	if (ctx.initialMessages && ctx.initialMessages.length > 0) {
		ctx.restoreReadFileState(ctx.initialMessages, getOriginalCwd());
		void ctx.restoreRemoteAgentTasks({
			abortController: new AbortController(),
			getAppState: () => ctx.store.getState(),
			setAppState: ctx.setAppState,
		});
	}
}
