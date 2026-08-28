import { describe, expect, it } from "bun:test";
import {
	deriveMessageDisplayState,
	deriveDisplayedMessages,
	derivePlaceholderText,
	deriveUsesSyncMessages,
} from "../../utils/messageDisplayState.js";
import type { Message } from "../../types/message.js";
import type { InProcessTeammateTaskState } from "../../tasks/InProcessTeammateTask/types.js";

// audit 1.1.1: 消息显示状态推导单元测试。行为等价 REPL.tsx:5748-5769 内联块。
// 3 derive 链: usesSyncMessages → displayedMessages → placeholderText。
// 关键不变量: displayedMessages 返回原数组引用 (不拷贝), 保持 ref-identity。

const fakeMessage = (text: string): Message =>
	({ type: "user", message: { content: text } }) as unknown as Message;

const messages: Message[] = [fakeMessage("a"), fakeMessage("b")];
const deferredMessages: Message[] = [fakeMessage("a")];

const teammateTask = {
	type: "in_process_teammate",
	messages: [fakeMessage("agent-msg")],
} as unknown as InProcessTeammateTaskState;

const baseInput = {
	showStreamingText: false,
	isLoading: false,
	viewedAgentTask: undefined,
	messages,
	deferredMessages,
	userInputOnProcessing: undefined,
	userInputBaseline: 0,
};

describe("deriveUsesSyncMessages", () => {
	it("true when showStreamingText (bypass defer while streaming)", () => {
		expect(deriveUsesSyncMessages(true, true)).toBe(true);
	});

	it("true when not loading (defer only matters during streaming)", () => {
		expect(deriveUsesSyncMessages(false, false)).toBe(true);
	});

	it("false when loading and no streaming (keep deferred path)", () => {
		expect(deriveUsesSyncMessages(false, true)).toBe(false);
	});
});

describe("deriveDisplayedMessages", () => {
	it("uses task messages when viewing agent", () => {
		const out = deriveDisplayedMessages(
			teammateTask,
			true,
			messages,
			deferredMessages,
		);
		expect(out).toBe(teammateTask.messages);
	});

	it("uses empty array when agent task has no messages", () => {
		const taskNoMsg = { type: "in_process_teammate" } as unknown as InProcessTeammateTaskState;
		const out = deriveDisplayedMessages(taskNoMsg, true, messages, deferredMessages);
		expect(out).toEqual([]);
	});

	it("uses sync messages when usesSyncMessages true", () => {
		const out = deriveDisplayedMessages(undefined, true, messages, deferredMessages);
		expect(out).toBe(messages);
	});

	it("uses deferredMessages when usesSyncMessages false", () => {
		const out = deriveDisplayedMessages(undefined, false, messages, deferredMessages);
		expect(out).toBe(deferredMessages);
	});

	it("agent view overrides usesSyncMessages (no fallthrough to leader)", () => {
		const out = deriveDisplayedMessages(teammateTask, false, messages, deferredMessages);
		expect(out).toBe(teammateTask.messages);
	});
});

describe("derivePlaceholderText", () => {
	it("shows input text before real message appears (length <= baseline)", () => {
		expect(derivePlaceholderText("draft", undefined, 2, 2)).toBe("draft");
	});

	it("hides once displayedMessages grows past baseline", () => {
		expect(derivePlaceholderText("draft", undefined, 3, 2)).toBe(undefined);
	});

	it("hides when no input processing", () => {
		expect(derivePlaceholderText(undefined, undefined, 1, 2)).toBe(undefined);
	});

	it("hides when viewing agent (different array, onAgentSubmit no placeholder)", () => {
		expect(derivePlaceholderText("draft", teammateTask, 1, 5)).toBe(undefined);
	});
});

describe("deriveMessageDisplayState (aggregate)", () => {
	it("idle: sync messages, no placeholder", () => {
		const state = deriveMessageDisplayState({ ...baseInput });
		expect(state.usesSyncMessages).toBe(true);
		expect(state.displayedMessages).toBe(messages);
		expect(state.placeholderText).toBe(undefined);
	});

	it("loading + streaming: sync messages", () => {
		const state = deriveMessageDisplayState({
			...baseInput,
			isLoading: true,
			showStreamingText: true,
		});
		expect(state.usesSyncMessages).toBe(true);
		expect(state.displayedMessages).toBe(messages);
	});

	it("loading + no streaming: deferred messages", () => {
		const state = deriveMessageDisplayState({
			...baseInput,
			isLoading: true,
			showStreamingText: false,
		});
		expect(state.usesSyncMessages).toBe(false);
		expect(state.displayedMessages).toBe(deferredMessages);
	});

	it("processing input shows placeholder until messages exceed baseline", () => {
		const state = deriveMessageDisplayState({
			...baseInput,
			userInputOnProcessing: "draft",
			userInputBaseline: 2,
			// messages.length === 2, at baseline → placeholder shown
		});
		expect(state.placeholderText).toBe("draft");
	});

	it("processing input hidden once messages exceed baseline", () => {
		const state = deriveMessageDisplayState({
			...baseInput,
			userInputOnProcessing: "draft",
			userInputBaseline: 1, // messages.length 2 > 1
		});
		expect(state.placeholderText).toBe(undefined);
	});

	it("agent view: task messages, no placeholder even with input processing", () => {
		const state = deriveMessageDisplayState({
			...baseInput,
			viewedAgentTask: teammateTask,
			userInputOnProcessing: "draft",
			userInputBaseline: 99,
		});
		expect(state.displayedMessages).toBe(teammateTask.messages);
		expect(state.placeholderText).toBe(undefined);
	});

	it("ref-identity: displayedMessages is same array ref, not a copy", () => {
		const state = deriveMessageDisplayState({ ...baseInput });
		expect(state.displayedMessages).toBe(messages);
		expect(state.displayedMessages).not.toBe([...messages]);
	});
});
