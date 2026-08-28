// audit 1.1.1: 从 REPL.tsx 抽出的 terminal/approval 状态推导。纯函数, 无 React, 无副作用。
// 5 个 derive 链式相依: isWaitingForApproval → isShowingLocalJSXCommand →
// titleIsAnimating → sessionStatus → waitingFor。REPL 保留 hook (useState/useEffect)
// 与 setHaikuTitle/haikuTitleAttemptedRef, 仅把纯计算外移。
// deps 全部经入参传入, 输出与原内联块字节等价。

import type { TabStatusKind } from "../ink/hooks/use-tab-status.js";
import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";

// toolJSX 的本地 JSX 命令判别用 shape — 只读 isLocalJSXCommand + jsx。
type ToolJsxLike = {
	isLocalJSXCommand?: boolean;
	jsx: React.ReactNode | null;
} | null;

export type TerminalApprovalInput = {
	toolUseConfirmQueue: readonly ToolUseConfirm[];
	promptQueue: readonly unknown[];
	pendingWorkerRequest: unknown;
	pendingSandboxRequest: unknown;
	toolJSX: ToolJsxLike;
	isLoading: boolean;
};

export type TerminalApprovalState = {
	isWaitingForApproval: boolean;
	isShowingLocalJSXCommand: boolean;
	titleIsAnimating: boolean;
	sessionStatus: TabStatusKind;
	waitingFor: string | undefined;
};

// isWaitingForApproval: 任一队列非空或 pending 请求存在。
export function deriveIsWaitingForApproval(input: TerminalApprovalInput): boolean {
	return (
		input.toolUseConfirmQueue.length > 0 ||
		input.promptQueue.length > 0 ||
		!!input.pendingWorkerRequest ||
		!!input.pendingSandboxRequest
	);
}

// isShowingLocalJSXCommand: 本地 JSX 命令弹窗在等待输入。要求 jsx != null —— 若
// flag 卡在 true 但 jsx 为 null, 视为未显示, 避免 TextInput focus 与队列处理器
// 被幻影 overlay 死锁。
export function deriveIsShowingLocalJSXCommand(
	toolJSX: ToolJsxLike,
): boolean {
	return toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null;
}

// 一次性聚合: 输入原始队列/请求/toolJSX/isLoading, 输出全部 5 个 derive。
// REPL 调用一次, 绑定到同名的 const, 下游读取不变 (字节等价)。
export function deriveTerminalApprovalState(
	input: TerminalApprovalInput,
): TerminalApprovalState {
	const isWaitingForApproval = deriveIsWaitingForApproval(input);
	const isShowingLocalJSXCommand = deriveIsShowingLocalJSXCommand(input.toolJSX);
	const titleIsAnimating =
		input.isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand;
	const sessionStatus: TabStatusKind =
		isWaitingForApproval || isShowingLocalJSXCommand
			? "waiting"
			: input.isLoading
				? "busy"
				: "idle";
	const waitingFor =
		sessionStatus !== "waiting"
			? undefined
			: input.toolUseConfirmQueue.length > 0
				? `approve ${input.toolUseConfirmQueue[0]!.tool.name}`
				: input.pendingWorkerRequest
					? "worker request"
					: input.pendingSandboxRequest
						? "sandbox request"
						: isShowingLocalJSXCommand
							? "dialog open"
							: "input needed";
	return {
		isWaitingForApproval,
		isShowingLocalJSXCommand,
		titleIsAnimating,
		sessionStatus,
		waitingFor,
	};
}
