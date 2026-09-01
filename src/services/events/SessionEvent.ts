// ar-plan PR #7 (S2.1): 事件溯源 — SessionEvent 类型 + 序列化 helper。
//
// P3 渐进迁移第一步: 引事件类型 + 旁路写 (shadow write)。mutableMessages 仍真源,
// 事件流 = 影子 (只写不读)。default-off (FUSION_CODE_EVENT_SOURCING=1)。
// 不落盘 (S2.1 仅内存, 落盘 = S2.3 远期)。纯类型 + helper, 无运行时副作用。
//
// 接 architecture/fusion-code-enhance-arch-ecosystem-0827.md §2.2 双写迁移设计。

// 事件类型 — 8 种, 覆盖 turn 生命周期 + 消息流 + compact + error。
// discriminated union 后续 PR (S2.2) 细化 per-type data; 此 PR data: unknown。
export type SessionEventType =
	| "user_message"
	| "assistant_message"
	| "tool_use"
	| "tool_result"
	| "compact"
	| "error"
	| "turn_start"
	| "turn_end";

// 单条事件。seq = 单调递增内存计数器 (非 Date.now — 脚本禁用时间源)。
// sourceEventSeqs = causation 链 (compact 事件指向被压事件 seq)。
// surfaceOp 字段已移除 (audit P2-2/R18): 写-only 死字段, 0 生产读取方。
export interface SessionEvent {
	seq: number;
	type: SessionEventType;
	data: unknown;
	sourceEventSeqs?: number[];
}

// 事件日志 = 有序事件数组 (内存, per-session)。
export type SessionEventLog = SessionEvent[];

// 序列化 helper — 纯函数, JSON 可序列化 (无循环引用, data 须可序列化)。
// 落盘 (S2.3) 时直接 JSON.stringify(serializeLog(log))。
export function serializeLog(log: SessionEventLog): string {
	return JSON.stringify(log);
}
