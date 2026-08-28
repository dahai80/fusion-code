// audit 1.1.1: 从 REPL.tsx 抽出的 composedOnScroll 包装纯路由。无 React hooks,
// 无 JSX, 无 await。唯一副作用 = mutate lastUserScrollTsRef.current + 调用 3 个
// 回调 + setAppState (与原 useCallback 体一致)。
// 语义: 用户滚动时打时间戳; sticky→onRepin (重新钉底); 非sticky→onScrollAway +
//   (KAIROS) maybeLoadOlder 懒加载历史 + (BUDDY) 滚动时清除 companionReaction 气泡
//   (absolute 定位覆盖 transcript, 滚动=用户想读下方内容)。
// feature("KAIROS")/feature("BUDDY") = bun:bundle 编译期 DCE 宏 (字面量参数, 任何
//   文件均可, 既有 utils 多处使用)。非 KAIROS/BUDDY 构建分支被 DCE 消除。
// 原 useCallback deps = [onRepin, onScrollAway, maybeLoadOlder, setAppState]
//   (feature() 是编译宏不在 deps); REPL 保留薄包装, 下游读取同名 const (字节等价)。

import { feature } from "bun:bundle";
import type { ScrollBoxHandle } from "../ink/components/ScrollBox.js";
import type { AppState } from "../state/AppStateStore.js";

// setAppState = zustand store.setState, updater 接收 prev → 完整 AppState (REPL 展开写法)。
// 仅清除 companionReaction 字段 (BUDDY 分支); undefined 时原样返回 prev (无变更)。
export type ComposedOnScrollSetters = {
	lastUserScrollTsRef: { current: number };
	onRepin: () => void;
	onScrollAway: (handle: ScrollBoxHandle) => void;
	maybeLoadOlder: (handle: ScrollBoxHandle) => void;
	setAppState: (updater: (prev: AppState) => AppState) => void;
};

// Compose useUnseenDivider's callbacks with the lazy-load trigger + companion
// bubble dismissal. 行为等价 REPL.tsx:1532-1556 useCallback 体。REPL 保留
// useCallback 薄包装 (deps [onRepin, onScrollAway, maybeLoadOlder, setAppState] 不变)。
export function applyComposedOnScroll(
	sticky: boolean,
	handle: ScrollBoxHandle,
	setters: ComposedOnScrollSetters,
): void {
	setters.lastUserScrollTsRef.current = Date.now();
	if (sticky) {
		setters.onRepin();
	} else {
		setters.onScrollAway(handle);
		if (feature("KAIROS")) setters.maybeLoadOlder(handle);
		// Dismiss the companion bubble on scroll — it's absolute-positioned
		// at bottom-right and covers transcript content. Scrolling = user is
		// trying to read something under it.
		if (feature("BUDDY")) {
			setters.setAppState((prev) =>
				prev.companionReaction === undefined
					? prev
					: {
							...prev,
							companionReaction: undefined,
						},
			);
		}
	}
}
