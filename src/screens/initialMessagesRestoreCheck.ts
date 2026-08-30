// audit 1.1.1 slice #57: initialMessages restore useEffect body 外移 (PURE-ROUTING-SUB-BLOCK effect-body variant, like #51/#54)。
// REPL() mount-once useEffect: --resume-session / ResumeConversation 传 initialMessages props → restoreReadFileState 提取已读文件状态 + restoreRemoteAgentTasks 还原远程 agent 任务。
// 原 useEffect body: guard (initialMessages && length > 0) → restoreReadFileState(initialMessages, getOriginalCwd()) + void restoreRemoteAgentTasks({abortController, getAppState, setAppState})。
// initialMessages (prop, deps 触发器但 mount-once 故省略 — 与原 eslint-disable 一致) + restoreReadFileState (REPL-local useCallback L2125 wrapper, 闭包捕获 readFileState/bashTools) +
// restoreRemoteAgentTasks (REPL-local no-op stub L418, 非 import) + store (useAppStateStore L787) + setAppState (useSetAppState L770) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出; helper 返 void (无 cleanup, mount-once 不需)。
// getOriginalCwd (bootstrap/state) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用, 保留 REPL import, helper 亦直接 import)。
// restoreRemoteAgentTasks 当前 no-op stub (RemoteAgentTask 已移除, cloud-only), 但对象仍构造 (字节等价, 不因 no-op 删 dead 构造)。
// 无 JSX → .ts。返 void。deps [] 不变 (mount-once, eslint-disable-next-line react-hooks/exhaustive-deps 保留)。

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

// REPL 保留 useEffect 薄壳:
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
