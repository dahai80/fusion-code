// audit 1.1.1 slice #34: idle-return-hint useEffect body extracted (PURE-ROUTING SUB-BLOCK class, 6th — like slice #29 maybeSendIdleNotification).
// REPL() idle-return-hint effect full flow: 5 early-return guards + setTimeout (stale-closure-bypass 5 positional args) + cleanup (clearTimeout + removeNotification + ref reset).
// The callback body generates Ink <Text> JSX (hint_v2 variant) → .tsx + React + Text import. Returns the timer handle, used by the useEffect cleanup.
// ctx carries 5 setTimeout-args (lqct/addNotif/msgsRef/mode/hintRef) + 2 guard/setter entries (removeNotif),
//   guard deps (lastQueryCompletionTime/isLoading) as separate ctx fields. getFeatureValue_CACHED_MAY_BE_STALE/logEvent/getGlobalConfig/getTotalInputTokens/formatTokens are standalone module imports.
import type { MutableRefObject } from "react";
import { getTotalInputTokens } from "../bootstrap/state.js";
import type { Notification } from "../context/notifications.js";
import { Text } from "../ink.js";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	getFeatureValue_CACHED_MAY_BE_STALE,
	logEvent,
} from "../services/analytics/index.js";
import type { Message as MessageType } from "../types/message.js";
import { getGlobalConfig } from "../utils/config.js";
import { formatTokens } from "../utils/format.js";

type IdleReturnHintCtx = {
	// guard deps
	lastQueryCompletionTime: number;
	isLoading: boolean;
	// setTimeout-arg (5 positional, stale-closure-bypass pattern kept)
	addNotification: (content: Notification) => void;
	messagesRef: MutableRefObject<MessageType[]>;
	idleHintShownRef: MutableRefObject<string | false>;
	// cleanup dep
	removeNotification: (key: string) => void;
};

// REPL keeps the useEffect thin shell:
//   useEffect(() => {
//     const timer = maybeScheduleIdleReturnHint({ lastQueryCompletionTime, isLoading, addNotification, messagesRef, idleHintShownRef, removeNotification });
//     return () => { if (timer) clearTimeout(timer); removeNotification("idle-return-hint"); idleHintShownRef.current = false; };
//   }, [lastQueryCompletionTime, isLoading, addNotification, removeNotification]);
// Returns NodeJS.Timeout | undefined: undefined = guard early-returned (no timer to clean up), otherwise the setTimeout handle.
export function maybeScheduleIdleReturnHint(
	ctx: IdleReturnHintCtx,
): ReturnType<typeof setTimeout> | undefined {
	if (ctx.lastQueryCompletionTime === 0) return;
	if (ctx.isLoading) return;
	const willowMode: string = getFeatureValue_CACHED_MAY_BE_STALE(
		"fusion_willow_mode",
		"off",
	);
	if (willowMode !== "hint" && willowMode !== "hint_v2") return;
	if (getGlobalConfig().idleReturnDismissed) return;
	const tokenThreshold = Number(
		process.env.FUSION_CODE_IDLE_TOKEN_THRESHOLD ?? 100_000,
	);
	if (getTotalInputTokens() < tokenThreshold) return;
	const idleThresholdMs =
		Number(process.env.FUSION_CODE_IDLE_THRESHOLD_MINUTES ?? 75) * 60_000;
	const elapsed = Date.now() - ctx.lastQueryCompletionTime;
	const remaining = idleThresholdMs - elapsed;
	const timer = setTimeout(
		(lqct, addNotif, msgsRef, mode, hintRef) => {
			if (msgsRef.current.length === 0) return;
			const totalTokens = getTotalInputTokens();
			const formattedTokens = formatTokens(totalTokens);
			const idleMinutes = (Date.now() - lqct) / 60_000;
			addNotif({
				key: "idle-return-hint",
				jsx:
					mode === "hint_v2" ? (
						<>
							<Text dimColor>new task? </Text>
							<Text color="suggestion">/clear</Text>
							<Text dimColor> to save </Text>
							<Text color="suggestion">{formattedTokens} tokens</Text>
						</>
					) : (
						<Text color="warning">
							new task? /clear to save {formattedTokens} tokens
						</Text>
					),
				priority: "medium",
				// Persist until submit — the hint fires at T+75min idle, user may
				// not return for hours. removeNotification in useEffect cleanup
				// handles dismissal. 0x7FFFFFFF = setTimeout max (~24.8 days).
				timeoutMs: 0x7fffffff,
			});
			hintRef.current = mode;
			logEvent("fusion_idle_return_action", {
				action:
					"hint_shown" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				variant:
					mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
				idleMinutes: Math.round(idleMinutes),
				messageCount: msgsRef.current.length,
				totalInputTokens: totalTokens,
			});
		},
		Math.max(0, remaining),
		ctx.lastQueryCompletionTime,
		ctx.addNotification,
		ctx.messagesRef,
		willowMode,
		ctx.idleHintShownRef,
	);
	return timer;
}
