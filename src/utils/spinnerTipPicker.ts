// audit 1.1.1: 从 REPL.tsx 抽出的 spinner tip 选取纯计算。无 React, 无 JSX。
// 唯一副作用 = 调用传入的 setter/ref (与原 useCallback 体一致)。
// resetLoadingState 每轮调用两次 (onQueryImpl tail + onQuery finally)。无 guard 则两次
//   都 pick → 两次 recordShownTip → 两次 saveGlobalConfig 连写。submit 时在 onSubmit
//   重置 tipPickedThisTurnRef。
// 原码体逐字外移; REPL 保留 useCallback 薄包装 (deps 数组不变), 下游读取同名 const (字节等价)。

import {
	getTipToShowOnSpinner,
	recordShownTip,
} from "src/services/tips/tipScheduler.js";
import type { Theme } from "src/utils/theme.js";
import type { AppState } from "../state/AppStateStore.js";
import type { Message as MessageType } from "../types/message.js";
import type { FileStateCache } from "./fileStateCache.js";
import { extractBashToolsFromMessages } from "./queryHelpers.js";

// REPL 实例绑定的 ref + setter。ref 来自 useRef, 每实例独立; 此处读/写 .current
// (不 mutate ref 本身)。setAppState = Zustand StoreApi<AppState>.setState, 接受 updater。
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
// 行为等价 REPL.tsx:1875-1909 useCallback 体。REPL 保留 useCallback 薄包装 (deps 不变)。
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
