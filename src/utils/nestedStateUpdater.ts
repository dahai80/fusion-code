// audit 1.1.1: 从 REPL.tsx getToolUseContext 抽出的两个同构嵌套-state 更新包装。
// updateFileHistoryState + updateAttributionState 原各 14 LOC, 结构一致:
//   setAppState((prev) => { const updated = updater(prev[key]); if (updated === prev[key]) return prev; return {...prev, [key]: updated} })
// 同-ref 跳过 = perf 优化 (fileHistoryTrackEdit 对已追踪文件返回 state 不触发 setState,
// 避免每次 no-op 通知所有 store listener)。两方法仅在 key + slice type 上不同 →
// 一个泛型 helper (literal-key union) 覆盖, REPL 薄包装传 "fileHistory"|"attribution"。
// 无 React hooks, 无 JSX, 无 await。唯一副作用 = 调 setAppState。

import type { AppState } from "../state/AppStateStore.js";

// 仅这两个 key: 都是顶层 slice, 各有独立 type, updater 返回同-ref 跳过。
export type NestedStateKey = "fileHistory" | "attribution";

type SetAppStateFn = (updater: (prev: AppState) => AppState) => void;

// 行为等价 REPL.tsx:2794-2820 updateFileHistoryState / updateAttributionState 方法体。
// REPL 保留薄包装: updateFileHistoryState: (u) => applyNestedStateUpdater(setAppState, "fileHistory", u)
// 字面量 key → TS 推断 K, updater 类型 = (prev: AppState[K]) => AppState[K], 与 ToolUseContext 签名一致。
export function applyNestedStateUpdater<K extends NestedStateKey>(
	setAppState: SetAppStateFn,
	key: K,
	updater: (prev: AppState[K]) => AppState[K],
): void {
	setAppState((prev) => {
		const updated = updater(prev[key]);
		if (updated === prev[key]) return prev;
		return {
			...prev,
			[key]: updated,
		};
	});
}
