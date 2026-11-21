// audit 1.1.1: pure routing wrapper for setToolJSX extracted from REPL.tsx. No React hooks, no JSX, no async.
// The only side effects = mutating localJSXCommandRef.current + calling setToolJSXInternal (same as the original useCallback body).
//   Semantics: local JSX commands (/btw etc. immediate) persist; tool updates cannot overwrite them unless explicitly cleared via clearLocalJSX.
// Original useCallback deps = [] (read-only ref + stable setter); REPL keeps a thin wrapper, downstream reads the same-named const (byte-equivalent).

import type { ReactNode } from "react";

// setToolJSX input. clearLocalJSX is only used by the onDone callback to explicitly clear the overlay.
export type SetToolJSXArgs = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	clearLocalJSX?: boolean;
} | null;

// localJSXCommandRef holds the persisted local JSX command (isLocalJSXCommand always true).
export type LocalJSXCommand = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand: true;
} | null;

// Internal state shape accepted by setToolJSXInternal (useState setter) (plus isImmediate?).
export type ToolJSXInternalState = {
	jsx: ReactNode | null;
	shouldHidePromptInput: boolean;
	shouldContinueAnimation?: true;
	showSpinner?: boolean;
	isLocalJSXCommand?: boolean;
	isImmediate?: boolean;
} | null;

// Ref + setter bound to a REPL instance. localJSXCommandRef = useRef<LocalJSXCommand>,
// setToolJSXInternal = the useState setter (always stable). This function mutates the ref / calls the setter directly.
export type SetToolJSXSetters = {
	localJSXCommandRef: { current: LocalJSXCommand };
	setToolJSXInternal: (value: ToolJSXInternalState) => void;
};

// Route a setToolJSX call: local JSX command stored separately so tools can't
// overwrite it unless they explicitly clear it (clearLocalJSX from onDone).
// Behavior-equivalent to the REPL.tsx:1284-1326 useCallback body. REPL keeps a thin useCallback wrapper (deps [] unchanged).
export function applyToolJSXUpdate(
	args: SetToolJSXArgs,
	setters: SetToolJSXSetters,
): void {
	// If setting a local JSX command, store it in the ref
	if (args?.isLocalJSXCommand) {
		const { clearLocalJSX: _omit, ...rest } = args;
		setters.localJSXCommandRef.current = {
			...rest,
			isLocalJSXCommand: true,
		};
		setters.setToolJSXInternal(rest);
		return;
	}

	// If there's an active local JSX command in the ref
	if (setters.localJSXCommandRef.current) {
		// Allow clearing only if explicitly requested (from onDone callbacks)
		if (args?.clearLocalJSX) {
			setters.localJSXCommandRef.current = null;
			setters.setToolJSXInternal(null);
			return;
		}
		// Otherwise, keep the local JSX command visible - ignore tool updates
		return;
	}

	// No active local JSX command, allow any update
	if (args?.clearLocalJSX) {
		setters.setToolJSXInternal(null);
		return;
	}
	setters.setToolJSXInternal(args);
}
