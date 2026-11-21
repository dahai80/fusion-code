// audit 1.1.1 slice #35: safeYoloMessage useEffect body extracted (PURE-ROUTING SUB-BLOCK class, 7th — like slice #34 maybeScheduleIdleReturnHint).
// REPL() auto-mode warning effect: on entering auto mode (Shift+Tab or startup), debounces 800ms then shows the "auto permissions" warning once, at most 3 times overall (count persisted across sessions).
// setTimeout-arg pattern (stale-closure-bypass) — ref + setMessages passed as 2 positional args, like #29/#34.
// Returns the timer handle, used by the useEffect cleanup for clearTimeout.
// ctx carries the guard dep (mode) + 2 setTimeout-args (ref/setMessages). getGlobalConfig/saveGlobalConfig/createSystemMessage/AUTO_MODE_DESCRIPTION are standalone module imports.
import type { MutableRefObject, SetStateAction } from "react";
import { AUTO_MODE_DESCRIPTION } from "../components/AutoModeOptInDialog.js";
import type { Message as MessageType } from "../types/message.js";
import { getGlobalConfig, saveGlobalConfig } from "../utils/config.js";
import { createSystemMessage } from "../utils/messages.js";

type SafeYoloMessageCtx = {
	// guard dep
	mode: string;
	// setTimeout-arg (2 positional, stale-closure-bypass pattern kept)
	safeYoloMessageShownRef: MutableRefObject<boolean>;
	setMessages: (action: SetStateAction<MessageType[]>) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => {
//     const timer = maybeScheduleSafeYoloMessage({ mode: toolPermissionContext.mode, safeYoloMessageShownRef, setMessages });
//     return () => { if (timer) clearTimeout(timer); };
//   }, [toolPermissionContext.mode, setMessages]);
// Returns NodeJS.Timeout | undefined: undefined = guard early-returned (no timer to clean up), otherwise the setTimeout handle.
// On guard early-return the ref must also be reset: ref.current = false (leaving auto mode → the warning can fire again on next entry).
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
