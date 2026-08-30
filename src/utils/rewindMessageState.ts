// audit 1.1.1: 从 REPL.tsx 抽出的对话 rewind/restore 纯计算。无 React, 无 JSX, 无副作用
// (仅调用传入的 setter, 与原 useCallback 体一致)。2 个 derive:
//   rewindConversationTo — 截断 messages 到目标 message 之前, 重置 conversation ID +
//     microcompact 状态 + 权限模式 + prompt suggestion (不动输入框)。
//   restoreMessageSync — rewind + 回填输入框文本/模式 + 恢复粘贴图片。auto-restore 直用
//     (与 abort 的 setMessages 同批渲染, 无闪烁); MessageSelector 经 handleRestoreMessage
//     setImmediate 包装。
// messagesRef 索引计算自 ref.current (setMessages wrapper 永远刷新), 调用方无 stale 闭包顾虑。
// 原码体逐字外移; REPL 保留 useCallback 薄包装 (deps 数组不变), 下游读取同名 const (字节等价)。
// feature("CONTEXT_COLLAPSE") 是 bun:bundle 编译期宏, 字符串字面量参数跨文件 DCE 安全。

import { feature } from "bun:bundle";
import { randomUUID } from "node:crypto";
import { logEvent } from "../services/analytics/index.js";
import { resetMicrocompactState } from "../services/compact/index.js";
import type { AppState } from "../state/AppStateStore.js";
import type { ImageBlockParam } from "../types/anthropic-protocol.js";
import type { Message as MessageType, UserMessage } from "../types/message.js";
import type { PromptInputMode } from "../types/textInputTypes.js";
import type { PastedContent } from "./config.js";
import { textForResubmit } from "./messages.js";

// REPL 实例绑定的 setter + messages ref。setter 来自 useState/useCallback/useSetAppState,
// 每实例独立。messagesRef 是 useRef<MessageType[]>, 此处读 .current (不 mutate ref 本身)。
// setAppState = Zustand StoreApi<AppState>.setState, 接受 (prev:AppState)=>AppState updater。
export type RewindMessageSetters = {
	messagesRef: { current: MessageType[] };
	setMessages: (next: MessageType[]) => void;
	// conversationId 是 useState(randomUUID()) 推断的 template-literal UUID 类型。
	// randomUUID() 返回同类型, 直接传入; REPL 调用方包一层 lambda 适配 Dispatch<SetStateAction>。
	setConversationId: (id: ReturnType<typeof randomUUID>) => void;
	setAppState: (updater: (prev: AppState) => AppState) => void;
};

export type RestoreMessageSetters = RewindMessageSetters & {
	setInputValue: (v: string) => void;
	setInputMode: (v: PromptInputMode) => void;
	setPastedContents: (next: Record<number, PastedContent>) => void;
};

// Rewind conversation state to just before `message`: slice messages,
// reset conversation ID, microcompact state, permission mode, prompt suggestion.
// Does NOT touch the prompt input. Index is computed from messagesRef (always
// fresh via the setMessages wrapper) so callers don't need to worry about
// stale closures.
// 行为等价 REPL.tsx:4639-4692 useCallback 体。REPL 保留 useCallback 薄包装 (deps 不变)。
export function rewindConversationTo(
	message: UserMessage,
	setters: RewindMessageSetters,
): void {
	const prev = setters.messagesRef.current;
	const messageIndex = prev.lastIndexOf(message);
	if (messageIndex === -1) return;
	logEvent("tengu_conversation_rewind", {
		preRewindMessageCount: prev.length,
		postRewindMessageCount: messageIndex,
		messagesRemoved: prev.length - messageIndex,
		rewindToMessageIndex: messageIndex,
	});
	setters.setMessages(prev.slice(0, messageIndex));
	// Careful, this has to happen after setMessages
	setters.setConversationId(randomUUID());
	// Reset cached microcompact state so stale pinned cache edits
	// don't reference tool_use_ids from truncated messages
	resetMicrocompactState();
	if (feature("CONTEXT_COLLAPSE")) {
		// Rewind truncates the REPL array. Commits whose archived span
		// was past the rewind point can't be projected anymore
		// (projectView silently skips them) but the staged queue and ID
		// maps reference stale uuids. Simplest safe reset: drop
		// everything. The ctx-agent will re-stage on the next
		// threshold crossing.
		/* eslint-disable @typescript-eslint/no-require-imports */
		(
			require("../services/contextCollapse/index.js") as typeof import("../services/contextCollapse/index.js")
		).resetContextCollapse();
		/* eslint-enable @typescript-eslint/no-require-imports */
	}

	// Restore state from the message we're rewinding to
	setters.setAppState((prev) => ({
		...prev,
		// Restore permission mode from the message
		toolPermissionContext:
			message.permissionMode &&
			prev.toolPermissionContext.mode !== message.permissionMode
				? {
						...prev.toolPermissionContext,
						mode: message.permissionMode,
					}
				: prev.toolPermissionContext,
		// Clear stale prompt suggestion from previous conversation state
		promptSuggestion: {
			text: null,
			promptId: null,
			shownAt: 0,
			acceptedAt: 0,
			generationRequestId: null,
		},
	}));
}

// Synchronous rewind + input population. Used directly by auto-restore on
// interrupt (so React batches with the abort's setMessages → single render,
// no flicker). MessageSelector wraps this in setImmediate via handleRestoreMessage.
// 行为等价 REPL.tsx:4698-4732 useCallback 体。
export function restoreMessageSync(
	message: UserMessage,
	setters: RestoreMessageSetters,
): void {
	rewindConversationTo(message, setters);
	const r = textForResubmit(message);
	if (r) {
		setters.setInputValue(r.text);
		setters.setInputMode(r.mode);
	}

	// Restore pasted images
	if (
		Array.isArray(message.message.content) &&
		message.message.content.some((block) => block.type === "image")
	) {
		const imageBlocks: Array<ImageBlockParam> = message.message.content.filter(
			(block) => block.type === "image",
		);
		if (imageBlocks.length > 0) {
			const newPastedContents: Record<number, PastedContent> = {};
			imageBlocks.forEach((block, index) => {
				if (block.source.type === "base64") {
					const id = message.imagePasteIds?.[index] ?? index + 1;
					newPastedContents[id] = {
						id,
						type: "image",
						content: block.source.data,
						mediaType: block.source.media_type,
					};
				}
			});
			setters.setPastedContents(newPastedContents);
		}
	}
}
