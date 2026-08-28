// audit 1.1.1: 从 REPL.tsx 抽出的 setInputValue 包装纯路由。无 React hooks, 无 JSX,
// 无 await。唯一副作用 = mutate 2 个 ref.current + 调用 3 个 setter (与原
// useCallback 体一致)。
// 语义: 用户输入时三件事:
//   (1) trySuggestBgPRIntercept(prev, value) 命中 → 提前 return (PR 建议拦截, 当前为
//       noop, 预留 hook);
//   (2) 空输入→非空输入 且 距上次滚动 ≥ RECENT_SCROLL_REPIN_WINDOW_MS (3s) → repinScroll
//       (全屏模式打字回钉底部; 用户 3s 内滚过 = 正在读, 不抢回视图);
//   (3) 同步 inputValueRef.current (调用方在 React commit 前读 ref 见新值, 如 auto-restore
//       finally 块的 === "" 守卫) + setInputValueRaw(value) + setIsPromptInputActive(非空)。
// 原 useCallback deps = [setIsPromptInputActive, repinScroll, trySuggestBgPRIntercept]
//   (refs 不在 deps; setInputValueRaw 是 useState setter 稳定)。REPL 保留薄包装, deps 不变;
//   下游读取同名 const (字节等价)。

export type InputValueStateSetters = {
	trySuggestBgPRIntercept: (prev: string, next: string) => boolean;
	repinScroll: () => void;
	setInputValueRaw: (value: string) => void;
	setIsPromptInputActive: (active: boolean) => void;
	inputValueRef: { current: string };
	lastUserScrollTsRef: { current: number };
	recentScrollRepinWindowMs: number;
};

// 行为等价 REPL.tsx:1558-1585 useCallback 体。REPL 保留 useCallback 薄包装
// (deps [setIsPromptInputActive, repinScroll, trySuggestBgPRIntercept] 不变)。
export function applySetInputValue(
	value: string,
	setters: InputValueStateSetters,
): void {
	if (setters.trySuggestBgPRIntercept(setters.inputValueRef.current, value)) {
		return;
	}
	// In fullscreen mode, typing into an empty prompt re-pins scroll to
	// bottom. Only fires on empty→non-empty so scrolling up to reference
	// something while composing a message doesn't yank the view back on
	// every keystroke. Restores the pre-fullscreen muscle memory of
	// typing to snap back to the end of the conversation.
	// Skipped if the user scrolled within the last 3s — they're actively
	// reading, not lost. lastUserScrollTsRef starts at 0 so the first-
	// ever keypress (no scroll yet) always repins.
	if (
		setters.inputValueRef.current === "" &&
		value !== "" &&
		Date.now() - setters.lastUserScrollTsRef.current >=
			setters.recentScrollRepinWindowMs
	) {
		setters.repinScroll();
	}
	// Sync ref immediately (like setMessages) so callers that read
	// inputValueRef before React commits — e.g. the auto-restore finally
	// block's `=== ''` guard — see the fresh value, not the stale render.
	setters.inputValueRef.current = value;
	setters.setInputValueRaw(value);
	setters.setIsPromptInputActive(value.trim().length > 0);
}
