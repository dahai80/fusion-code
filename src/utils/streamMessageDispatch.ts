// audit §1.1.1 slice #30: stream message dispatch sub-block extracted from
// REPL onQueryEvent → handleMessageFromStream first callback (L2954-3016).
//
// Routes an incoming streamed message to the right setMessages mutation:
//   - compact-boundary → replace (or append in fullscreen) + bump conversationId
//   - ephemeral tool-progress tick → replace last same-tool tick (no array blowup)
//   - otherwise → append
// Plus proactive context-block toggle on API errors / success.
// Pure-routing sub-block (proven extraction class via slices #19/#25-#29):
// reads only setters + module helpers, no React hooks, no closures over REPL state
// beyond the explicitly-passed ctx.

import { feature } from "bun:bundle";
import { randomUUID, type UUID } from "crypto";

import type { Message as MessageType } from "../types/message.js";
import { isFullscreenEnvEnabled } from "./fullscreen.js";
import { isCompactBoundaryMessage } from "./messages.js";
import { isEphemeralToolProgress } from "./sessionStorage.js";

// Proactive module shape — only the two methods this dispatch calls.
// Optional (null when PROACTIVE/KAIROS off); the dispatch guards with ?. and feature().
type ProactiveDispatchModule = {
	setContextBlocked?: (blocked: boolean) => void;
};

export type StreamMessageDispatchCtx = {
	setMessages: (
		update: MessageType[] | ((prev: MessageType[]) => MessageType[]),
	) => void;
	// setConversationId is a React useState setter typed as
	// Dispatch<SetStateAction<UUID>>; accept the narrower (id: UUID) form
	// (randomUUID returns UUID, so the call site satisfies it).
	setConversationId: (id: UUID) => void;
	proactiveModule: ProactiveDispatchModule | null;
};

export function createStreamMessageDispatch(
	ctx: StreamMessageDispatchCtx,
): (newMessage: MessageType) => void {
	const { setMessages, setConversationId, proactiveModule } = ctx;
	return (newMessage: MessageType): void => {
		if (isCompactBoundaryMessage(newMessage)) {
			// item 17: 全屏跨多次压缩保留完整 pre-compact 历史。:598 useMemo
			// 已解耦 syntheticStreamingToolUseMessages (仅 normalizedMessages
			// 变=turn 边界跑, 非每 delta), O(n) 跨多日罕见可接受。虚拟滚动绑
			// 内存 (mounted-item count, 非总数)。query.ts 仍 boundary 裁 API。
			if (isFullscreenEnvEnabled()) {
				setMessages((old) => [...old, newMessage]);
			} else {
				setMessages(() => [newMessage]);
			}
			// Bump conversationId so Messages.tsx row keys change and
			// stale memoized rows remount with post-compact content.
			setConversationId(randomUUID());
			// Compaction succeeded — clear the context-blocked flag so ticks resume
			if (feature("PROACTIVE") || feature("KAIROS")) {
				proactiveModule?.setContextBlocked(false);
			}
		} else if (
			newMessage.type === "progress" &&
			isEphemeralToolProgress(newMessage.data.type)
		) {
			// Replace the previous ephemeral progress tick for the same tool
			// call instead of appending. Sleep/Bash emit a tick per second and
			// only the last one is rendered; appending blows up the messages
			// array (13k+ observed) and the transcript (120MB of sleep_progress
			// lines). useLogMessages tracks length, so same-length replacement
			// also skips the transcript write.
			// agent_progress / hook_progress / skill_progress are NOT ephemeral
			// — each carries distinct state the UI needs (e.g. subagent tool
			// history). Replacing those leaves the AgentTool UI stuck at
			// "Initializing…" because it renders the full progress trail.
			setMessages((oldMessages) => {
				const last = oldMessages.at(-1);
				if (
					last?.type === "progress" &&
					last.parentToolUseID === newMessage.parentToolUseID &&
					last.data.type === newMessage.data.type
				) {
					const copy = oldMessages.slice();
					copy[copy.length - 1] = newMessage;
					return copy;
				}
				return [...oldMessages, newMessage];
			});
		} else {
			setMessages((oldMessages) => [...oldMessages, newMessage]);
		}
		// Block ticks on API errors to prevent tick → error → tick
		// runaway loops (e.g., auth failure, rate limit, blocking limit).
		// Cleared on compact boundary (above) or successful response (below).
		if (feature("PROACTIVE") || feature("KAIROS")) {
			if (
				newMessage.type === "assistant" &&
				"isApiErrorMessage" in newMessage &&
				newMessage.isApiErrorMessage
			) {
				proactiveModule?.setContextBlocked(true);
			} else if (newMessage.type === "assistant") {
				proactiveModule?.setContextBlocked(false);
			}
		}
	};
}
