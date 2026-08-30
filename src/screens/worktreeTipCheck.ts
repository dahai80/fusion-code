// audit 1.1.1 slice #42: worktree sparsePaths tip useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#41)。
// REPL() 检测 worktree 创建慢 (>15s) 且未用 sparsePaths → 一次性提示用户配置 worktree.sparsePaths。
// 原 useEffect body。worktreeTipShownRef (ref) + setMessages 经 ctx 传入 (闭包捕获), 行为字节等价。
// useRefs()/useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// getCurrentWorktreeSession (utils/worktree.js) + createSystemMessage 直接 import (非 REPL state, per imported-helpers-directly rule)。
// 无 JSX → .ts。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [setMessages] 不变 (worktreeTipShownRef 是 ref, 稳定引用, 省略合法, 与原一致)。

import type { MutableRefObject, SetStateAction } from "react";
import type { Message as MessageType } from "../types/message.js";
import { createSystemMessage } from "../utils/messages.js";
import { getCurrentWorktreeSession } from "../utils/worktree.js";

type WorktreeTipCheckCtx = {
	worktreeTipShownRef: MutableRefObject<boolean>;
	setMessages: (action: SetStateAction<MessageType[]>) => void;
};

// REPL 保留 useEffect 薄壳:
//   const worktreeTipShownRef = useRef(false);
//   useEffect(() => maybeShowWorktreeTip({ worktreeTipShownRef, setMessages }), [setMessages]);
export function maybeShowWorktreeTip(ctx: WorktreeTipCheckCtx): void {
	if (ctx.worktreeTipShownRef.current) return;
	const wt = getCurrentWorktreeSession();
	if (!wt?.creationDurationMs || wt.usedSparsePaths) return;
	if (wt.creationDurationMs < 15_000) return;
	ctx.worktreeTipShownRef.current = true;
	const secs = Math.round(wt.creationDurationMs / 1000);
	ctx.setMessages((prev) => [
		...prev,
		createSystemMessage(
			`Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .claude/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": ["src", "packages/foo"]}}\`.`,
			"info",
		),
	]);
}
