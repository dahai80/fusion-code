// audit 1.1.1 slice #44: promptQueueUseCount analytics useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41/#42/#43)。
// REPL() 追踪 prompt queue 用量: empty→non-empty 转换时 fire-once saveGlobalConfig(promptQueueUseCount++)。
// 防 render-loop spam saveGlobalConfig → ELOCKED → ~/.claude.json 损坏 (GH #3117)。
// 原 useEffect body。hasCountedQueueUseRef (ref) + queueLen (queuedCommands.length, derived dep) 经 ctx 传入, 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// saveGlobalConfig (utils/config.js) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用, 不移除 REPL import)。
// 无 JSX → .ts。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [queuedCommands.length] 不变 (hasCountedQueueUseRef 是 ref, 稳定引用, 省略合法, queueLen 即 derived dep, 与原一致)。

import type { MutableRefObject } from "react";
import { saveGlobalConfig } from "../utils/config.js";

type QueueUseCountCheckCtx = {
	hasCountedQueueUseRef: MutableRefObject<boolean>;
	queueLen: number;
};

// REPL 保留 useEffect 薄壳:
//   const hasCountedQueueUseRef = useRef(false);
//   useEffect(() => maybeCountQueueUse({ hasCountedQueueUseRef, queueLen: queuedCommands.length }), [queuedCommands.length]);
export function maybeCountQueueUse(ctx: QueueUseCountCheckCtx): void {
	if (ctx.queueLen < 1) {
		ctx.hasCountedQueueUseRef.current = false;
		return;
	}
	if (ctx.hasCountedQueueUseRef.current) return;
	ctx.hasCountedQueueUseRef.current = true;
	saveGlobalConfig((current) => ({
		...current,
		promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1,
	}));
}
