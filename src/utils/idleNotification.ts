// audit 1.1.1: 从 REPL.tsx idle-notification useEffect 的 setTimeout 回调体抽出 (PURE-ROUTING SUB-BLOCK class, 像 slice #25/#26/#27/#28)。
// 行为等价 REPL.tsx:4489-4512 (setTimeout 回调体)。无 React hooks, 无 JSX, 无 await (void sendNotification fire-and-forget)。
// 响应结束后若用户 idle (未交互 + idleTime >= messageIdleNotifThresholdMs + 非加载/非工具/无聚焦对话框) → 发 idle_prompt 通知。
// 回调的 5 个 setTimeout-arg 参数作 ctx 传入 (React 反模式: setTimeout 传参绕过 stale closure, 保留原语义)。
//   ctx = {lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal}。
//   getLastInteractionTime/sendNotification/getGlobalConfig 为独立 module import。
import { getLastInteractionTime } from "../bootstrap/state.js";
import type { TerminalNotification } from "../ink/useTerminalNotification.js";
import { sendNotification } from "../services/notifier.js";
import { getGlobalConfig } from "./config.js";
import type { getFocusedInputDialog } from "./focusedDialogSelector.js";

type ToolJSX = {
	jsx: React.ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	isImmediate?: boolean;
} | null;

type IdleNotificationCtx = {
	lastQueryCompletionTime: number;
	isLoading: boolean;
	toolJSX: ToolJSX;
	focusedInputDialogRef: React.MutableRefObject<
		ReturnType<typeof getFocusedInputDialog> | undefined
	>;
	terminal: TerminalNotification;
};

// REPL 保留 useEffect 薄壳 (guards + setTimeout setup + clearTimeout cleanup), 回调体改为:
//   (_lastQueryCompletionTime, _isLoading, _toolJSX, _focusedInputDialogRef, _terminal) => maybeSendIdleNotification({lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal});
export function maybeSendIdleNotification(ctx: IdleNotificationCtx): void {
	const lastUserInteraction = getLastInteractionTime();
	if (lastUserInteraction > ctx.lastQueryCompletionTime) {
		// User interacted since Claude finished — not idle, don't notify.
		return;
	}
	const idleTimeSinceResponse = Date.now() - ctx.lastQueryCompletionTime;
	if (
		!ctx.isLoading &&
		!ctx.toolJSX &&
		// Use ref to get current dialog state, avoiding stale closure
		ctx.focusedInputDialogRef.current === undefined &&
		idleTimeSinceResponse >= getGlobalConfig().messageIdleNotifThresholdMs
	) {
		void sendNotification(
			{
				message: "Claude is waiting for your input",
				notificationType: "idle_prompt",
			},
			ctx.terminal,
		);
	}
}
