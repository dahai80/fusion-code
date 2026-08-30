// audit 1.1.1 slice #38: undercover-callout useEffect body 外移 (INLINE-ASYNC-IIFE, 2nd — 像 slice #32 runImmediateCommand)。
// REPL() mount-only: internal build 时检查 repo 分类 + undercover 自动提示, 满足则 setShowUndercoverCallout(true)。
// 原 async IIFE inside useEffect。setShowUndercoverCallout 经 ctx 传入 (闭包捕获), 行为字节等价。
// isInternalBuild (buildConstants) + 2 动态 import (commitAttribution/undercover) 留 helper 内 (纯 import 非 REPL state, per imported-helpers-directly rule)。
// 无 JSX/无 hook → .ts。void 返回 (REPL 薄壳 void 调用)。

import { isInternalBuild } from "../utils/buildConstants.js";

type UndercoverCalloutCheckCtx = {
	setShowUndercoverCallout: (v: boolean) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => {
//     applyUndercoverCalloutCheck({ setShowUndercoverCallout });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);
// isInternalBuild() guard 移入 helper (非 REPL state, pure import)。deps [] 不变, eslint-disable 保留。
export function applyUndercoverCalloutCheck(
	ctx: UndercoverCalloutCheckCtx,
): void {
	if (isInternalBuild()) {
		void (async () => {
			// Wait for repo classification to settle (memoized, no-op if primed).
			const { isInternalModelRepo } = await import(
				"../utils/commitAttribution.js"
			);
			await isInternalModelRepo();
			const { shouldShowUndercoverAutoNotice } = await import(
				"../utils/undercover.js"
			);
			if (shouldShowUndercoverAutoNotice()) {
				ctx.setShowUndercoverCallout(true);
			}
		})();
	}
}
