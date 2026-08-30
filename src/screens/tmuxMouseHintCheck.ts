// audit 1.1.1 slice #51: tmux mouse-off one-time hint useEffect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41-#50)。
// REPL() mount-once: isFullscreenEnvEnabled() → maybeGetTmuxMouseHint() async → 若有 hint 则 addNotification({key:"tmux-mouse-hint", text:hint, priority:"low"})。
// 不再 mutate tmux session-scoped mouse option (poison sibling panes); tmux 用户已知此 tradeoff。
// 原 useEffect body。addNotification (deps 触发器) 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出; deps [] 不变 (mount-once, eslint-disable-next-line react-hooks/exhaustive-deps 保留)。
// isFullscreenEnvEnabled + maybeGetTmuxMouseHint (utils/fullscreen) 直接 import (非 REPL state, per imported-helpers-directly rule; isFullscreenEnvEnabled REPL 多用保留 REPL import, maybeGetTmuxMouseHint REPL 单用提取后 REPL import 移除)。
// 无 JSX → .ts。返 Promise<void> (REPL 薄壳 useEffect 透传, 无 cleanup)。

import type { Notification } from "../context/notifications.js";
import {
	isFullscreenEnvEnabled,
	maybeGetTmuxMouseHint,
} from "../utils/fullscreen.js";

type TmuxMouseHintCheckCtx = {
	addNotification: (content: Notification) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => { void maybeShowTmuxMouseHint({ addNotification }); // eslint-disable-next-line react-hooks/exhaustive-deps }, []);
export async function maybeShowTmuxMouseHint(
	ctx: TmuxMouseHintCheckCtx,
): Promise<void> {
	if (!isFullscreenEnvEnabled()) {
		return;
	}
	const hint = await maybeGetTmuxMouseHint();
	if (hint) {
		ctx.addNotification({
			key: "tmux-mouse-hint",
			text: hint,
			priority: "low",
		});
	}
}
