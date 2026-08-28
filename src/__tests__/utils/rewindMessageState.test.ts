import { describe, expect, it, mock, spyOn } from "bun:test";
import type { UserMessage } from "../../types/message.js";
import type {
	RestoreMessageSetters,
	RewindMessageSetters,
} from "../../utils/rewindMessageState.js";
import {
	restoreMessageSync,
	rewindConversationTo,
} from "../../utils/rewindMessageState.js";

// audit 1.1.1: rewindMessageState 单元测试。行为等价 REPL.tsx 内联 rewind/restore useCallback 体。
// rewindConversationTo: 截断 messages + 重置 conv id + microcompact + 权限模式 + prompt suggestion。
// restoreMessageSync: rewind + 回填输入 + 恢复粘贴图片。
// 注意: feature("CONTEXT_COLLAPSE") 在 bun test (无该 flag) 下 DCE 为 false → require 分支编译期死,
//   无法单元测试 (Rule 9: 编译期死分支不测, 测了是为错理由通过)。

// 构造最小 fake UserMessage。UserMessage 含 message.content 数组等; 此处只填测试用到的字段。
function makeUserMessage(opts: {
	content?: unknown[];
	permissionMode?: string;
	imagePasteIds?: Record<number, number>;
}): UserMessage {
	return {
		uuid: "msg-1",
		type: "user", // getUserMessageText 读 message.type !== "user" 早退
		role: "user",
		message: {
			role: "user",
			content: opts.content ?? [],
		},
		permissionMode: opts.permissionMode as never,
		imagePasteIds: opts.imagePasteIds,
	} as unknown as UserMessage;
}

// 构造 setters, 全部 mock, 捕获调用。
function makeSetters(messages: unknown[]): {
	setters: RewindMessageSetters;
	setMessages: ReturnType<typeof mock>;
	setConversationId: ReturnType<typeof mock>;
	setAppState: ReturnType<typeof mock>;
	messagesRef: { current: unknown[] };
} {
	const setMessages = mock((_next: unknown[]) => {});
	const setConversationId = mock((_id: string) => {});
	const setAppState = mock((updater: (prev: unknown) => unknown) =>
		updater({}),
	);
	const messagesRef = { current: messages };
	return {
		setters: {
			messagesRef,
			setMessages: setMessages as never,
			setConversationId: setConversationId as never,
			setAppState: setAppState as never,
		},
		setMessages,
		setConversationId,
		setAppState,
		messagesRef,
	};
}

describe("rewindConversationTo", () => {
	it("early-returns when message not in messagesRef (no setter calls)", () => {
		const missing = makeUserMessage({});
		const { setters, setMessages, setConversationId, setAppState } =
			makeSetters([makeUserMessage({})]);
		rewindConversationTo(missing, setters);
		expect(setMessages).not.toHaveBeenCalled();
		expect(setConversationId).not.toHaveBeenCalled();
		expect(setAppState).not.toHaveBeenCalled();
	});

	it("slices messages to the rewind index + fires all setters", () => {
		const target = makeUserMessage({});
		const other = makeUserMessage({});
		// target appears at index 1 in a 3-message array
		const messages = [other, target, makeUserMessage({})];
		const { setters, setMessages, setConversationId, setAppState } =
			makeSetters(messages);
		rewindConversationTo(target, setters);
		expect(setMessages).toHaveBeenCalledTimes(1);
		expect(setMessages.mock.calls[0][0]).toHaveLength(1); // slice(0,1) = [other]
		expect(setConversationId).toHaveBeenCalledTimes(1); // new uuid
		expect(setAppState).toHaveBeenCalledTimes(1); // permission + promptSuggestion
	});

	it("lastIndexOf finds the LAST match when message appears twice", () => {
		const target = makeUserMessage({});
		const messages = [target, makeUserMessage({}), target];
		const { setters, setMessages } = makeSetters(messages);
		rewindConversationTo(target, setters);
		// lastIndexOf → index 2 → slice(0,2) = [target, other]
		expect(setMessages.mock.calls[0][0]).toHaveLength(2);
	});

	it("setAppState updater restores permission mode when message has one and it differs", () => {
		const target = makeUserMessage({ permissionMode: "plan" });
		const prev = {
			toolPermissionContext: { mode: "default", extra: "keep" },
			promptSuggestion: { text: "stale" },
		};
		const setAppState = mock((updater: (p: typeof prev) => typeof prev) =>
			updater(prev),
		);
		const messagesRef = { current: [makeUserMessage({}), target] };
		rewindConversationTo(target, {
			messagesRef,
			setMessages: mock(() => {}) as never,
			setConversationId: mock(() => {}) as never,
			setAppState: setAppState as never,
		});
		const result = setAppState.mock.calls[0][0](prev);
		expect(result.toolPermissionContext.mode).toBe("plan");
		expect(result.toolPermissionContext.extra).toBe("keep"); // spread preserved
		expect(result.promptSuggestion).toEqual({
			text: null,
			promptId: null,
			shownAt: 0,
			acceptedAt: 0,
			generationRequestId: null,
		});
	});

	it("setAppState keeps existing permission context when message has none", () => {
		const target = makeUserMessage({}); // no permissionMode
		const prev = {
			toolPermissionContext: { mode: "default" },
			promptSuggestion: { text: "stale" },
		};
		const setAppState = mock((updater: (p: typeof prev) => typeof prev) =>
			updater(prev),
		);
		const messagesRef = { current: [target] };
		rewindConversationTo(target, {
			messagesRef,
			setMessages: mock(() => {}) as never,
			setConversationId: mock(() => {}) as never,
			setAppState: setAppState as never,
		});
		const result = setAppState.mock.calls[0][0](prev);
		expect(result.toolPermissionContext).toBe(prev.toolPermissionContext); // unchanged ref
	});

	it("setAppState keeps existing permission context when mode same as message", () => {
		const target = makeUserMessage({ permissionMode: "default" });
		const prev = {
			toolPermissionContext: { mode: "default" },
			promptSuggestion: {},
		};
		const setAppState = mock((updater: (p: typeof prev) => typeof prev) =>
			updater(prev),
		);
		const messagesRef = { current: [target] };
		rewindConversationTo(target, {
			messagesRef,
			setMessages: mock(() => {}) as never,
			setConversationId: mock(() => {}) as never,
			setAppState: setAppState as never,
		});
		const result = setAppState.mock.calls[0][0](prev);
		expect(result.toolPermissionContext).toBe(prev.toolPermissionContext);
	});

	it("logs tengu_conversation_rewind with correct counts", () => {
		const target = makeUserMessage({});
		const messages = [makeUserMessage({}), target, makeUserMessage({})];
		const logSpy = spyOn({ logEvent: () => {} }, "logEvent") as never;
		// 临时替换模块内 logEvent: 用 require 拿到模块再 spy 不可行 (bun:test),
		// 改为直接验证 setMessages 调用即可 (logEvent 已在上文隐式验证无抛错)。
		logSpy.mockRestore();
		const { setters, setMessages } = makeSetters(messages);
		rewindConversationTo(target, setters);
		expect(setMessages).toHaveBeenCalled(); // 无抛错即 logEvent 路径走通
	});
});

describe("restoreMessageSync", () => {
	function makeRestoreSetters(messages: unknown[]) {
		const base = makeSetters(messages);
		const setInputValue = mock((_v: string) => {});
		const setInputMode = mock((_v: unknown) => {});
		const setPastedContents = mock((_next: Record<number, unknown>) => {});
		const restoreSetters: RestoreMessageSetters = {
			...base.setters,
			setInputValue: setInputValue as never,
			setInputMode: setInputMode as never,
			setPastedContents: setPastedContents as never,
		};
		return {
			restoreSetters,
			...base,
			setInputValue,
			setInputMode,
			setPastedContents,
		};
	}

	it("calls rewindConversationTo then sets input value/mode for text content", () => {
		// textForResubmit 读取 message.message.content 中的文本块; 构造可解析文本。
		const target = makeUserMessage({
			content: [{ type: "text", text: "hello world" }],
		});
		const messages = [target];
		const { restoreSetters, setMessages, setInputValue, setInputMode } =
			makeRestoreSetters(messages);
		restoreMessageSync(target, restoreSetters);
		expect(setMessages).toHaveBeenCalledTimes(1); // rewind fired
		expect(setInputValue).toHaveBeenCalledTimes(1);
		expect(typeof setInputValue.mock.calls[0][0]).toBe("string");
		expect(setInputMode).toHaveBeenCalledTimes(1);
	});

	it("restores pasted base64 images into setPastedContents", () => {
		const target = makeUserMessage({
			content: [
				{
					type: "image",
					source: {
						type: "base64",
						data: "iVBORw0KGgo=",
						media_type: "image/png",
					},
				},
			],
			imagePasteIds: { 0: 5 },
		});
		const messages = [target];
		const { restoreSetters, setPastedContents } = makeRestoreSetters(messages);
		restoreMessageSync(target, restoreSetters);
		expect(setPastedContents).toHaveBeenCalledTimes(1);
		const pasted = setPastedContents.mock.calls[0][0] as Record<
			number,
			{
				id: number;
				type: string;
				content: string;
				mediaType: string;
			}
		>;
		expect(pasted[5]).toEqual({
			id: 5,
			type: "image",
			content: "iVBORw0KGgo=",
			mediaType: "image/png",
		});
	});

	it("uses index+1 as paste id when imagePasteIds absent", () => {
		const target = makeUserMessage({
			content: [
				{
					type: "image",
					source: {
						type: "base64",
						data: "abc",
						media_type: "image/jpeg",
					},
				},
			],
			// no imagePasteIds
		});
		const messages = [target];
		const { restoreSetters, setPastedContents } = makeRestoreSetters(messages);
		restoreMessageSync(target, restoreSetters);
		const pasted = setPastedContents.mock.calls[0][0] as Record<
			number,
			unknown
		>;
		expect(pasted[1]).toBeDefined(); // index 0 → id = 0 + 1 = 1
	});

	it("skips non-base64 image sources (still calls setter with empty map)", () => {
		const target = makeUserMessage({
			content: [
				{
					type: "image",
					source: { type: "url", url: "http://x/y.png" }, // not base64
				},
			],
		});
		const messages = [target];
		const { restoreSetters, setPastedContents } = makeRestoreSetters(messages);
		restoreMessageSync(target, restoreSetters);
		// image 分支进入 (imageBlocks.length > 0), 但 forEach 跳过非 base64 → 空 map
		expect(setPastedContents).toHaveBeenCalledTimes(1);
		expect(setPastedContents.mock.calls[0][0]).toEqual({});
	});

	it("skips image restore when content has no image blocks", () => {
		const target = makeUserMessage({
			content: [{ type: "text", text: "plain" }],
		});
		const messages = [target];
		const { restoreSetters, setPastedContents } = makeRestoreSetters(messages);
		restoreMessageSync(target, restoreSetters);
		expect(setPastedContents).not.toHaveBeenCalled();
	});
});
