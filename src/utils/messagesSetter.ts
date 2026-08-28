// audit 1.1.1: 从 REPL.tsx 抽出的 setMessages 包装纯路由。无 React hooks, 无 JSX,
// 无 await。唯一副作用 = mutate 3 个 ref.current + 调用 rawSetMessages (与原
// useCallback 体一致)。
// 语义: 维护 messagesRef (最新消息数组镜像, 闭包安全) + userInputBaselineRef/
//   userMessagePendingRef (用户消息占位符基准)。回调体做三件事:
//   (1) 计算 next (函数式 action 或直赋值), 同步 messagesRef.current;
//   (2) 若 next 缩短 (compact/rewind/clear) → clamp baseline 为 0 (防占位符 stale);
//   (3) 若 next 增长且 userMessagePending → 检查新增项是否含 human turn:
//       含 → pending=false (用户消息已落地, 停止追踪); 不含 → bump baseline=next.length
//       (异步 bridge/hook/scheduled 任务在用户消息前落地 → 占位符保持可见)。
//   最后 rawSetMessages(next) 触发 React 重渲染。
// 原 useCallback deps = [] (全部走 ref + rawSetMessages, 无闭包捕获)。REPL 保留薄包装,
//   deps [] 不变 (helper 无 React); 下游读取同名 const (字节等价)。
import type { Message as MessageType } from "../types/message.js";
import { isHumanTurn } from "./messagePredicates.js";

// 三个 ref 镜像 React state, 回调体内读写 (避免 stale closure)。
// messagesRef: 最新 messages 数组; userInputBaselineRef: 占位符基准长度;
//   userMessagePendingRef: 用户消息是否尚未落地。
export type MessagesSetterRefs = {
	messagesRef: { current: MessageType[] };
	userInputBaselineRef: { current: number };
	userMessagePendingRef: { current: boolean };
};

export type MessagesSetterSetters = MessagesSetterRefs & {
	rawSetMessages: (next: MessageType[]) => void;
};

// 行为等价 REPL.tsx:1431-1462 useCallback 体。REPL 保留 useCallback 薄包装
// (deps [] 不变 — helper 无 React 依赖, 全部走 setters/ref)。
export function applySetMessages(
	action: React.SetStateAction<MessageType[]>,
	setters: MessagesSetterSetters,
): void {
	const prev = setters.messagesRef.current;
	const next =
		typeof action === "function" ? action(setters.messagesRef.current) : action;
	setters.messagesRef.current = next;
	if (next.length < setters.userInputBaselineRef.current) {
		// Shrank (compact/rewind/clear) — clamp so placeholderText's length
		// check can't go stale.
		setters.userInputBaselineRef.current = 0;
	} else if (
		next.length > prev.length &&
		setters.userMessagePendingRef.current
	) {
		// Grew while the submitted user message hasn't landed yet. If the
		// added messages don't include it (bridge status, hook results,
		// scheduled tasks landing async during processUserInputBase), bump
		// baseline so the placeholder stays visible. Once the user message
		// lands, stop tracking — later additions (assistant stream) should
		// not re-show the placeholder.
		const delta = next.length - prev.length;
		const added =
			prev.length === 0 || next[0] === prev[0]
				? next.slice(-delta)
				: next.slice(0, delta);
		if (added.some(isHumanTurn)) {
			setters.userMessagePendingRef.current = false;
		} else {
			setters.userInputBaselineRef.current = next.length;
		}
	}
	setters.rawSetMessages(next);
}
