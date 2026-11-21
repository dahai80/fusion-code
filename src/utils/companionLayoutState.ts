// audit 1.1.1: companion layout state derivation extracted from REPL.tsx. Pure functions, no React, no side effects.
// 4 derives: companionNarrow -> companionVisible, toolJsxCentered -> centeredModal.
// REPL keeps all useState/useRef bindings; only the pure computation is moved out, downstream reads the same-name const (byte-equivalent).
// isFullscreenEnvEnabled() is a runtime env check (utils/fullscreen.ts), no React dependency, safe to call inside a pure function.

import type { ReactNode } from "react";
import { MIN_COLS_FOR_FULL_SPRITE } from "../buddy/CompanionSprite.js";
import { isFullscreenEnvEnabled } from "./fullscreen.js";

// Layout-related fields of toolJSX (a subset of the REPL useState shape, only the 3 used here).
// Avoids pulling in the full toolJSX type (with unrelated fields like shouldContinueAnimation/showSpinner/isImmediate).
export type ToolJsxLayoutLike = {
	jsx: ReactNode | null;
	shouldHidePromptInput?: boolean;
	isLocalJSXCommand?: boolean;
} | null;

export type CompanionLayoutInput = {
	transcriptCols: number;
	toolJSX: ToolJsxLayoutLike;
	focusedInputDialog: string | undefined;
	showBashesDialog: string | boolean;
};

export type CompanionLayoutState = {
	companionNarrow: boolean;
	companionVisible: boolean;
	toolJsxCentered: boolean;
	centeredModal: ReactNode | null;
};

// companionNarrow: on a narrow terminal (< MIN_COLS_FOR_FULL_SPRITE) the companion collapses to a single line,
// REPL stacks itself (fullscreen above the input, scrollback below), no longer side-by-side columns.
export function deriveCompanionNarrow(transcriptCols: number): boolean {
	return transcriptCols < MIN_COLS_FOR_FULL_SPRITE;
}

// companionVisible: hide the sprite when PromptInput early-returns BackgroundTasksDialog.
// The sprite shares a line with PromptInput; the dialog Pane divider is drawn at the useTerminalSize width but only spans
// terminalWidth - spriteWidth, so the divider stops early and text wraps. footerSelection is not checked:
// pill FOCUS (down arrow to the tasks pill) must keep the sprite visible so right-arrow can navigate to it.
export function deriveCompanionVisible(
	toolJSX: ToolJsxLayoutLike,
	focusedInputDialog: string | undefined,
	showBashesDialog: string | boolean,
): boolean {
	return (
		!toolJSX?.shouldHidePromptInput && !focusedInputDialog && !showBashesDialog
	);
}

// toolJsxCentered: in fullscreen all local-jsx slash commands float to the modal slot —
// FullscreenLayout wraps them in an absolutely-positioned bottom-anchored Pane (▔ divider, ModalContext).
// Pane/Dialog detect the context and skip their own top-level frame. Non-fullscreen uses the inline render below.
export function deriveToolJsxCentered(toolJSX: ToolJsxLayoutLike): boolean {
	return isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
}

// centeredModal: when toolJsxCentered, use toolJSX.jsx as the modal content, otherwise null.
export function deriveCenteredModal(
	toolJsxCentered: boolean,
	toolJSX: ToolJsxLayoutLike,
): ReactNode | null {
	// When toolJsxCentered is true, toolJSX must be non-null (centered = fullscreen +
	// isLocalJSXCommand===true, and the latter requires toolJSX non-null), so ?. is equivalent to the original `!` assertion.
	return toolJsxCentered ? (toolJSX?.jsx ?? null) : null;
}

// One-shot aggregation: takes the raw layout state, outputs all 4 derives.
// REPL calls it once, binds to the same-name const, downstream reads unchanged (byte-equivalent).
export function deriveCompanionLayoutState(
	input: CompanionLayoutInput,
): CompanionLayoutState {
	const companionNarrow = deriveCompanionNarrow(input.transcriptCols);
	const companionVisible = deriveCompanionVisible(
		input.toolJSX,
		input.focusedInputDialog,
		input.showBashesDialog,
	);
	const toolJsxCentered = deriveToolJsxCentered(input.toolJSX);
	const centeredModal = deriveCenteredModal(toolJsxCentered, input.toolJSX);
	return { companionNarrow, companionVisible, toolJsxCentered, centeredModal };
}
