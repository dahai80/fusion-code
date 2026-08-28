import { describe, expect, it, mock } from "bun:test";
import type { Message as MessageType } from "../../types/message.js";
import {
	applySetMessages,
	type MessagesSetterSetters,
} from "../../utils/messagesSetter.js";

// audit 1.1.1: applySetMessages 单元测试。行为等价 REPL.tsx:1431-1462 setMessages
// useCallback 体。三动作:
//   (1) 计算 next (函数式 action 或直赋值) + 同步 messagesRef.current;
//   (2) next 缩短 → userInputBaselineRef clamp 为 0 (防占位符 stale);
//   (3) next 增长 + userMessagePending → 检查新增项含 human turn:
//       含 → pending=false; 不含 → baseline=next.length (占位符保持可见)。
//   最后 rawSetMessages(next) 触发渲染。
// isHumanTurn 判定 message.type === "user" && !isMeta && toolUseResult === undefined
//   (见 messagePredicates.ts), 测试用 {type:"user"} / {type:"assistant"} 最小假对象
//   (函数只读 type/isMeta/toolUseResult 字段)。

function human(): MessageType {
	return { type: "user", content: [] } as unknown as MessageType;
}
function assistant(): MessageType {
	return { type: "assistant", content: [] } as unknown as MessageType;
}

function makeSetters(
	initialMessages: MessageType[] = [],
	baseline = 0,
	pending = false,
): {
	setters: MessagesSetterSetters;
	messagesRef: { current: MessageType[] };
	userInputBaselineRef: { current: number };
	userMessagePendingRef: { current: boolean };
	rawSetMessages: ReturnType<typeof mock>;
	calls: MessageType[][];
} {
	const messagesRef = { current: [...initialMessages] };
	const userInputBaselineRef = { current: baseline };
	const userMessagePendingRef = { current: pending };
	const calls: MessageType[][] = [];
	const rawSetMessages = mock((next: MessageType[]) => {
		calls.push(next);
	});
	return {
		setters: {
			messagesRef,
			userInputBaselineRef,
			userMessagePendingRef,
			rawSetMessages: rawSetMessages as never,
		},
		messagesRef,
		userInputBaselineRef,
		userMessagePendingRef,
		rawSetMessages,
		calls,
	};
}

describe("applySetMessages", () => {
	it("direct-value action: writes next + mirrors messagesRef + calls rawSetMessages once", () => {
		const { setters, messagesRef, calls } = makeSetters();
		const next = [human()];
		applySetMessages(next, setters);
		expect(messagesRef.current).toBe(next);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(next);
	});

	it("function action: invokes action with messagesRef.current", () => {
		const initial = [human()];
		const { setters, messagesRef, calls } = makeSetters(initial);
		const appended = [initial[0], assistant()];
		applySetMessages(() => appended, setters);
		expect(messagesRef.current).toBe(appended);
		expect(calls[0]).toBe(appended);
	});

	it("shrink (compact/rewind/clear): clamps userInputBaselineRef to 0", () => {
		const { setters, userInputBaselineRef } = makeSetters(
			[human(), assistant()],
			2,
		);
		applySetMessages([human()], setters);
		expect(userInputBaselineRef.current).toBe(0);
	});

	it("grow with human turn in added slice + pending: clears userMessagePending", () => {
		// prev=[a0], next=[a0, user1] (appended at tail). added = tail slice = [user1]
		const prev = [assistant()];
		const { setters, userMessagePendingRef, userInputBaselineRef } =
			makeSetters(prev, 1, true);
		applySetMessages([...prev, human()], setters);
		expect(userMessagePendingRef.current).toBe(false);
		// baseline NOT bumped when user turn lands
		expect(userInputBaselineRef.current).toBe(1);
	});

	it("grow with only non-human added + pending: bumps baseline to next.length", () => {
		// prev=[a0], next=[a0, a1] (no human). added=[a1] → pending stays, baseline=2
		const prev = [assistant()];
		const { setters, userMessagePendingRef, userInputBaselineRef } =
			makeSetters(prev, 1, true);
		applySetMessages([...prev, assistant()], setters);
		expect(userMessagePendingRef.current).toBe(true);
		expect(userInputBaselineRef.current).toBe(2);
	});

	it("grow WITHOUT pending: neither baseline nor pending touched", () => {
		const prev = [assistant()];
		const { setters, userMessagePendingRef, userInputBaselineRef } =
			makeSetters(prev, 1, false);
		applySetMessages([...prev, assistant()], setters);
		expect(userMessagePendingRef.current).toBe(false);
		expect(userInputBaselineRef.current).toBe(1);
	});

	it("prepend slice (next[0] !== prev[0]): added taken from front", () => {
		// prev=[a0], next=[user0, a0] (prepended). added = front slice = [user0]
		const prev = [assistant()];
		const { setters, userMessagePendingRef } = makeSetters(prev, 1, true);
		applySetMessages([human(), prev[0]], setters);
		expect(userMessagePendingRef.current).toBe(false);
	});

	it("prev empty + grow: added = tail slice (guard prev.length === 0)", () => {
		const { setters, userMessagePendingRef, userInputBaselineRef } =
			makeSetters([], 0, true);
		applySetMessages([human()], setters);
		expect(userMessagePendingRef.current).toBe(false);
		expect(userInputBaselineRef.current).toBe(0);
	});
});
