// audit 1.1.1 slice #35: safeYoloMessage useEffect body 外移 (PURE-ROUTING SUB-BLOCK class, 7th — 像 slice #34 maybeScheduleIdleReturnHint)。
// REPL() auto-mode 警告 effect: 进 auto 模式 (Shift+Tab 或启动) 时 debounce 800ms 弹一次 "auto permissions" 警告, 全程最多 3 次 (跨 session 持久化 count)。
// setTimeout-arg pattern (stale-closure-bypass) — ref + setMessages 作 2 个 positional arg 传入, 像 #29/#34。
// 返回 timer handle, useEffect cleanup 用之 clearTimeout。
// ctx 携带 guard dep (mode) + 2 setTimeout-arg (ref/setMessages)。getGlobalConfig/saveGlobalConfig/createSystemMessage/AUTO_MODE_DESCRIPTION 为独立 module import。
import type { MutableRefObject, SetStateAction } from "react";
import { AUTO_MODE_DESCRIPTION } from "../components/AutoModeOptInDialog.js";
import type { Message as MessageType } from "../types/message.js";
import { getGlobalConfig, saveGlobalConfig } from "../utils/config.js";
import { createSystemMessage } from "../utils/messages.js";

type SafeYoloMessageCtx = {
	// guard dep
	mode: string;
	// setTimeout-arg (2 positional, stale-closure-bypass pattern 保留)
	safeYoloMessageShownRef: MutableRefObject<boolean>;
	setMessages: (action: SetStateAction<MessageType[]>) => void;
};

// REPL 保留 useEffect 薄壳:
//   useEffect(() => {
//     const timer = maybeScheduleSafeYoloMessage({ mode: toolPermissionContext.mode, safeYoloMessageShownRef, setMessages });
//     return () => { if (timer) clearTimeout(timer); };
//   }, [toolPermissionContext.mode, setMessages]);
// 返回 NodeJS.Timeout | undefined: undefined = guard 早退 (无 timer 需 cleanup), 否则 setTimeout handle。
// guard 早退时还要复位 ref.current = false (离开 auto 模式 → 下次进 auto 可再弹)。
export function maybeScheduleSafeYoloMessage(
	ctx: SafeYoloMessageCtx,
): ReturnType<typeof setTimeout> | undefined {
	if (ctx.mode !== "auto") {
		ctx.safeYoloMessageShownRef.current = false;
		return;
	}
	if (ctx.safeYoloMessageShownRef.current) return;
	const config = getGlobalConfig();
	const count = config.autoPermissionsNotificationCount ?? 0;
	if (count >= 3) return;
	const timer = setTimeout(
		(ref, setMessages) => {
			ref.current = true;
			saveGlobalConfig((prev) => {
				const prevCount = prev.autoPermissionsNotificationCount ?? 0;
				if (prevCount >= 3) return prev;
				return {
					...prev,
					autoPermissionsNotificationCount: prevCount + 1,
				};
			});
			setMessages((prev) => [
				...prev,
				createSystemMessage(AUTO_MODE_DESCRIPTION, "warn"),
			]);
		},
		800,
		ctx.safeYoloMessageShownRef,
		ctx.setMessages,
	);
	return timer;
}
