// audit 1.1.1 slice #43: sandbox-unavailable mount effect body 外移 (PURE-ROUTING-SUB-BLOCK, like #27/#28/#35/#41/#42)。
// REPL() 挂载时检测 sandbox 不可用原因: isSandboxRequired → stderr+gracefulShutdownSync(1) 拒绝启动; 否则 logForDebugging + addNotification 提示 "sandbox disabled · /sandbox"。
// 原 useEffect body。addNotification 经 ctx 传入 (闭包捕获), 行为字节等价。
// useEffect() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// SandboxManager (src/utils/sandbox) + gracefulShutdownSync + logForDebugging + Text(ink) 直接 import (非 REPL state, per imported-helpers-directly rule; 全部 REPL 多用, 不移除 REPL import)。
// 生成 JSX (notification.jsx) → .tsx。返 void (REPL 薄壳 useEffect 透传, 无 cleanup)。
// deps [addNotification] 不变 (addNotification 是 useCallback 稳定引用, fire-once, 与原一致)。

import { SandboxManager } from "src/utils/sandbox/sandbox-adapter.js";
import type { Notification } from "../context/notifications.js";
import { Text } from "../ink.js";
import { logForDebugging } from "../utils/debug.js";
import { gracefulShutdownSync } from "../utils/gracefulShutdown.js";

type SandboxUnavailableCheckCtx = {
	addNotification: (content: Notification) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => maybeShowSandboxUnavailable({ addNotification }), [addNotification]);
export function maybeShowSandboxUnavailable(
	ctx: SandboxUnavailableCheckCtx,
): void {
	const reason = SandboxManager.getSandboxUnavailableReason();
	if (!reason) return;
	if (SandboxManager.isSandboxRequired()) {
		process.stderr.write(
			`\nError: sandbox required but unavailable: ${reason}\n` +
				`  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
		);
		gracefulShutdownSync(1, "other");
		return;
	}
	logForDebugging(`sandbox disabled: ${reason}`, {
		level: "warn",
	});
	ctx.addNotification({
		key: "sandbox-unavailable",
		jsx: (
			<>
				<Text color="warning">sandbox disabled</Text>
				<Text dimColor> · /sandbox</Text>
			</>
		),
		priority: "medium",
	});
}
