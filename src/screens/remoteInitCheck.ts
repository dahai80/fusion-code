// audit 1.1.1 slice #46: handleRemoteInit useCallback body 外移 (PURE-ROUTING-CALLBACK, like #24 submitIncomingPrompt / #41 requestPrompt)。
// REPL() CCR 远程初始化回调: 按 CCR 可用 slash-command 列表过滤 localCommands (保留 CCR 列出的命令 OR 远程安全的命令)。
// 原 useCallback body。setLocalCommands 经 ctx 传入 (闭包捕获, useState setter 稳定引用 deps [setLocalCommands]), 行为字节等价。
// filterCommandsForRemoteMode (commands.js) + Command 类型 (commands.js re-export from types/command.js) 直接 import (非 REPL state, per imported-helpers-directly rule; REPL 多用, 不移除 REPL import)。
// 无 JSX/无 hook → .ts。返 callback (remoteSlashCommands: string[]) => void (REPL useCallback 薄壳透传, deps [setLocalCommands] 不变)。
// setLocalCommands 是 useState setter, 稳定引用, deps [setLocalCommands] 与原一致。

import type { Command } from "../commands.js";
import { filterCommandsForRemoteMode } from "../commands.js";

type RemoteInitCheckCtx = {
	setLocalCommands: (updater: (prev: Command[]) => Command[]) => void;
};

// REPL 保留 useCallback 薄壳:
//   const handleRemoteInit = useCallback(
//     (remoteSlashCommands: string[]) => applyRemoteInit({ setLocalCommands })(remoteSlashCommands),
//     [setLocalCommands],
//   );
export function applyRemoteInit(
	ctx: RemoteInitCheckCtx,
): (remoteSlashCommands: string[]) => void {
	return (remoteSlashCommands: string[]) => {
		const remoteCommandSet = new Set(remoteSlashCommands);
		// Keep commands that CCR lists OR that are safe for remote mode
		ctx.setLocalCommands((prev) =>
			filterCommandsForRemoteMode(prev).length > 0
				? prev.filter(
						(cmd) =>
							remoteCommandSet.has(cmd.name) ||
							filterCommandsForRemoteMode([cmd]).length > 0,
					)
				: prev.filter((cmd) => remoteCommandSet.has(cmd.name)),
		);
	};
}
