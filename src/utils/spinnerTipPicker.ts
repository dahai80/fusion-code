// audit 1.1.1: spinner tip selection pure computation extracted from REPL.tsx. No React, no JSX.
// The only side effects = calls to the passed-in setter/ref (identical to the original useCallback body).
// resetLoadingState is called twice per turn (onQueryImpl tail + onQuery finally). Without a guard both
//   calls pick -> two recordShownTip -> two back-to-back saveGlobalConfig writes. On submit, onSubmit
//   resets tipPickedThisTurnRef.
// Original code body moved out verbatim; REPL keeps a thin useCallback wrapper (deps array unchanged), downstream reads the same-name const (byte-equivalent).

import {
	getTipToShowOnSpinner,
	recordShownTip,
} from "src/services/tips/tipScheduler.js";
import type { Theme } from "src/utils/theme.js";
import type { AppState } from "../state/AppStateStore.js";
import type { Message as MessageType } from "../types/message.js";
import type { FileStateCache } from "./fileStateCache.js";
import { extractBashToolsFromMessages } from "./queryHelpers.js";

// Refs + setter bound to the REPL instance. Refs come from useRef, per-instance; this reads/writes .current
// (does not mutate the ref itself). setAppState = Zustand StoreApi<AppState>.setState, accepts an updater.
export type SpinnerTipPickerSetters = {
	messagesRef: { current: MessageType[] };
	tipPickedThisTurnRef: { current: boolean };
	bashToolsProcessedIdx: { current: number };
	bashTools: { current: Set<string> };
	readFileState: { current: FileStateCache };
	theme: Theme;
	setAppState: (updater: (prev: AppState) => AppState) => void;
};

// Pick a fresh spinner tip for the current turn. Idempotent within a turn via
// tipPickedThisTurnRef guard. Scans new bash tools since last pick, accumulates
// into bashTools ref, then queries getTipToShowOnSpinner and writes the result
// (or clears it) into appState.spinnerTip.
// Behavior-equivalent to the REPL.tsx:1875-1909 useCallback body. REPL keeps a thin useCallback wrapper (deps unchanged).
export function pickNewSpinnerTip(setters: SpinnerTipPickerSetters): void {
	if (setters.tipPickedThisTurnRef.current) return;
	setters.tipPickedThisTurnRef.current = true;
	const newMessages = setters.messagesRef.current.slice(
		setters.bashToolsProcessedIdx.current,
	);
	for (const tool of extractBashToolsFromMessages(newMessages)) {
		setters.bashTools.current.add(tool);
	}
	setters.bashToolsProcessedIdx.current = setters.messagesRef.current.length;
	void getTipToShowOnSpinner({
		theme: setters.theme,
		readFileState: setters.readFileState.current,
		bashTools: setters.bashTools.current,
	}).then(async (tip) => {
		if (tip) {
			const content = await tip.content({
				theme: setters.theme,
			});
			setters.setAppState((prev) => ({
				...prev,
				spinnerTip: content,
			}));
			recordShownTip(tip);
		} else {
			setters.setAppState((prev) => {
				if (prev.spinnerTip === undefined) return prev;
				return {
					...prev,
					spinnerTip: undefined,
				};
			});
		}
	});
}
