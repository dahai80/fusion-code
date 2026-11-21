// audit 1.1.1: terminal/approval state derivation extracted from REPL.tsx. Pure functions, no React, no side effects.
// 5 derives chained dependently: isWaitingForApproval -> isShowingLocalJSXCommand ->
// titleIsAnimating -> sessionStatus -> waitingFor. REPL keeps the hooks (useState/useEffect)
// and setHaikuTitle/haikuTitleAttemptedRef; only the pure computation is moved out.
// All deps passed in via parameters; output is byte-equivalent to the original inline block.

import type { ToolUseConfirm } from "../components/permissions/PermissionRequest.js";
import type { TabStatusKind } from "../ink/hooks/use-tab-status.js";

// Shape for the local JSX command discrimination of toolJSX — only reads isLocalJSXCommand + jsx.
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

// isWaitingForApproval: any queue non-empty or a pending request exists.
export function deriveIsWaitingForApproval(
	input: TerminalApprovalInput,
): boolean {
	return (
		input.toolUseConfirmQueue.length > 0 ||
		input.promptQueue.length > 0 ||
		!!input.pendingWorkerRequest ||
		!!input.pendingSandboxRequest
	);
}

// isShowingLocalJSXCommand: the local JSX command dialog is waiting for input. Requires jsx != null — if the
// flag is stuck at true but jsx is null, treat it as not shown, preventing TextInput focus and the queue handler
// from being deadlocked by a phantom overlay.
export function deriveIsShowingLocalJSXCommand(toolJSX: ToolJsxLike): boolean {
	return toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null;
}

// One-shot aggregation: takes the raw queues/requests/toolJSX/isLoading, outputs all 5 derives.
// REPL calls it once, binds to the same-name const, downstream reads unchanged (byte-equivalent).
export function deriveTerminalApprovalState(
	input: TerminalApprovalInput,
): TerminalApprovalState {
	const isWaitingForApproval = deriveIsWaitingForApproval(input);
	const isShowingLocalJSXCommand = deriveIsShowingLocalJSXCommand(
		input.toolJSX,
	);
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
				? `approve ${input.toolUseConfirmQueue[0]?.tool.name}`
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
