// audit 1.1.1: focusedInputDialog priority cascade extracted from REPL.tsx. Pure function, no React, no side effects.
// Priority cascade across the 20 dialog types: exit > message-selector > typing-suppress > sandbox-permission >
// (when toolJSX is not blocking) tool-permission > prompt > worker-sandbox > elicitation > cost > idle-return >
// ultraplan-choice > ultraplan-launch > ide-onboarding > model-switch(ant) > undercover(ant) >
// effort > remote > lsp-rec > plugin-hint > desktop-upsell。
// feature("ULTRAPLAN") + isInternalBuild() are both runtime checks (non-React), callable inside a pure function.
// feature() is a bun:bundle compile-time macro; string-literal arguments are DCE-safe across files (precedent: src/utils/*.ts).

import { feature } from "bun:bundle";
import { isInternalBuild } from "./buildConstants.js";

// Animation-related fields of toolJSX (subset of the REPL useState shape, only the 1 field used here).
// Avoids pulling in the full toolJSX type (which includes jsx/shouldHidePromptInput/showSpinner/isLocalJSXCommand etc.).
export type ToolJsxFocusLike = {
	shouldContinueAnimation?: true;
} | null;

// Input: 23 raw state fields. Queue-like fields are only truth-checked via `[0]`; use readonly unknown[] to avoid pulling element types.
// recommendation/idleReturn/ultraplan etc. are only truth-checked; use unknown to avoid pulling concrete object types.
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

// Priority cascade: returns the dialog type that should currently be focused, undefined if none.
// Behavior-equivalent to the inline function at REPL.tsx:2449-2539. REPL calls it once and binds to a same-named const; downstream reads unchanged (byte-equivalent).
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
	if (allowDialogsWithAnimation && input.lspRecommendation)
		return "lsp-recommendation";
	if (allowDialogsWithAnimation && input.hintRecommendation)
		return "plugin-hint";
	if (allowDialogsWithAnimation && input.showDesktopUpsellStartup)
		return "desktop-upsell";
	return undefined;
}
