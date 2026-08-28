// audit 1.1.1: 从 REPL.tsx 抽出的 focusedInputDialog 优先级级联。纯函数, 无 React, 无副作用。
// 20 个对话框类型的优先级判定: exit > message-selector > typing-suppress > sandbox-permission >
// (toolJSX 不阻塞时) tool-permission > prompt > worker-sandbox > elicitation > cost > idle-return >
// ultraplan-choice > ultraplan-launch > ide-onboarding > model-switch(ant) > undercover(ant) >
// effort > remote > lsp-rec > plugin-hint > desktop-upsell。
// feature("ULTRAPLAN") + isInternalBuild() 都是 runtime 检查 (非 React), 可在纯函数内调用。
// feature() 是 bun:bundle 编译期宏, 字符串字面量参数跨文件 DCE 安全 (precedent: src/utils/*.ts)。

import { feature } from "bun:bundle";
import { isInternalBuild } from "./buildConstants.js";

// toolJSX 的动画相关字段 (REPL useState 形状的子集, 仅取此处用到的 1 个)。
// 避免拉入完整 toolJSX 类型 (含 jsx/shouldHidePromptInput/showSpinner/isLocalJSXCommand 等)。
export type ToolJsxFocusLike = {
	shouldContinueAnimation?: true;
} | null;

// 输入: 23 个原始状态字段。队列类只取 `[0]` 真值检查, 用 readonly unknown[] 不拉具体元素类型。
// recommendation/idleReturn/ultraplan 等只做真值检查, 用 unknown 不拉具体对象类型。
export type FocusedDialogInput = {
	isExiting: boolean;
	exitFlow: unknown;
	isMessageSelectorVisible: boolean;
	isPromptInputActive: boolean;
	sandboxPermissionRequestQueue: readonly unknown[];
	toolJSX: ToolJsxFocusLike;
	toolUseConfirmQueue: readonly unknown[];
	promptQueue: readonly unknown[];
	workerSandboxPermissionsQueue: readonly unknown[];
	elicitationQueue: readonly unknown[];
	showingCostDialog: boolean;
	idleReturnPending: unknown;
	isLoading: boolean;
	ultraplanPendingChoice: unknown;
	ultraplanLaunchPending: unknown;
	showIdeOnboarding: boolean;
	showModelSwitchCallout: boolean;
	showUndercoverCallout: boolean;
	showEffortCallout: boolean;
	showRemoteCallout: boolean;
	lspRecommendation: unknown;
	hintRecommendation: unknown;
	showDesktopUpsellStartup: boolean;
};

export type FocusedDialogKind =
	| "message-selector"
	| "sandbox-permission"
	| "tool-permission"
	| "prompt"
	| "worker-sandbox-permission"
	| "elicitation"
	| "cost"
	| "idle-return"
	| "init-onboarding"
	| "ide-onboarding"
	| "model-switch"
	| "undercover-callout"
	| "effort-callout"
	| "remote-callout"
	| "lsp-recommendation"
	| "plugin-hint"
	| "desktop-upsell"
	| "ultraplan-choice"
	| "ultraplan-launch";

// 优先级级联: 返回当前应聚焦的对话框类型, 无则 undefined。
// 行为等价 REPL.tsx:2449-2539 内联函数。REPL 调用一次, 绑定同名 const, 下游读取不变 (字节等价)。
export function getFocusedInputDialog(
	input: FocusedDialogInput,
): FocusedDialogKind | undefined {
	if (input.isExiting || input.exitFlow) return undefined;
	if (input.isMessageSelectorVisible) return "message-selector";
	if (input.isPromptInputActive) return undefined;
	if (input.sandboxPermissionRequestQueue[0]) return "sandbox-permission";

	const allowDialogsWithAnimation =
		!input.toolJSX || input.toolJSX.shouldContinueAnimation;
	if (allowDialogsWithAnimation && input.toolUseConfirmQueue[0])
		return "tool-permission";
	if (allowDialogsWithAnimation && input.promptQueue[0]) return "prompt";
	if (allowDialogsWithAnimation && input.workerSandboxPermissionsQueue[0])
		return "worker-sandbox-permission";
	if (allowDialogsWithAnimation && input.elicitationQueue[0])
		return "elicitation";
	if (allowDialogsWithAnimation && input.showingCostDialog) return "cost";
	if (allowDialogsWithAnimation && input.idleReturnPending)
		return "idle-return";
	if (
		feature("ULTRAPLAN") &&
		allowDialogsWithAnimation &&
		!input.isLoading &&
		input.ultraplanPendingChoice
	)
		return "ultraplan-choice";
	if (
		feature("ULTRAPLAN") &&
		allowDialogsWithAnimation &&
		!input.isLoading &&
		input.ultraplanLaunchPending
	)
		return "ultraplan-launch";
	if (allowDialogsWithAnimation && input.showIdeOnboarding)
		return "ide-onboarding";
	if (
		isInternalBuild() &&
		allowDialogsWithAnimation &&
		input.showModelSwitchCallout
	)
		return "model-switch";
	if (
		isInternalBuild() &&
		allowDialogsWithAnimation &&
		input.showUndercoverCallout
	)
		return "undercover-callout";
	if (allowDialogsWithAnimation && input.showEffortCallout)
		return "effort-callout";
	if (allowDialogsWithAnimation && input.showRemoteCallout)
		return "remote-callout";
	if (allowDialogsWithAnimation && input.lspRecommendation)
		return "lsp-recommendation";
	if (allowDialogsWithAnimation && input.hintRecommendation)
		return "plugin-hint";
	if (allowDialogsWithAnimation && input.showDesktopUpsellStartup)
		return "desktop-upsell";
	return undefined;
}
