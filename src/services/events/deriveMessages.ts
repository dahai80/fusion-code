// ar-plan PR #8 (S2.2): 事件溯源 — deriveMessages 投影 + assertDualWrite dev 断言。
//
// 旁路写之上加投影: deriveMessages(log) 重建 Message[]。dev 断言 derived === mutableMessages,
// 验证事件流完备。**仍不切读** (prod 不读 log, 投影仅供 dev 断言 + 单测)。
// prod byte-identical: assertDualWrite 非 dev 或 env 未设 → 早 return。

import { deepStrictEqual } from "node:assert";
import type { Message } from "../../types/message.js";
import { isDevEnv } from "../../utils/buildConstants.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import type { SessionEventLog } from "./SessionEvent.js";

// 投影 — 从事件流重建 Message[]。纯函数, 可单测。
// 消息类事件 (user_message/assistant_message/tool_result) → data 即 Message。
// compact 事件 = 边界 (替换前缀, 见 arch-ecosystem §2.2): 按序遇 compact 则
// 截断其后重建 (compact 后的 events 即 compact 后的 mutableMessages 真源)。
// turn_start/turn_end/error → 非消息, 跳过。seq 乱序输入 → 按 seq 排序输出。
export function deriveMessages(log: SessionEventLog): Message[] {
	const sorted = [...log].sort((a, b) => a.seq - b.seq);
	const out: Message[] = [];
	for (const ev of sorted) {
		switch (ev.type) {
			case "user_message":
			case "assistant_message":
			case "tool_result": {
				// data = pushed Message (single) 或 Message[] (user_message spread)。
				// 单测保证 data 形态; 投影摊平数组。
				if (Array.isArray(ev.data)) {
					for (const m of ev.data as Message[]) out.push(m);
				} else {
					out.push(ev.data as Message);
				}
				break;
			}
			case "compact": {
				// compact 边界: 截断此前累积, compact 后的事件重建 = 新真源。
				// P1-3: compact data 携带替换状态, 否则 assertDualWrite 每次压缩假阳性
				// (mutableMessages=[boundary] 但 derived=[] → dev 永远抓不到真漂移)。
				// 两形态: snipResult {executed, messages} → re-seed out = messages;
				//   compact_boundary Message → out = [该 boundary] (mutable 仅 push boundary)。
				out.length = 0;
				const compactData = ev.data as {
					executed?: boolean;
					messages?: Message[];
				};
				if (
					compactData?.executed === true &&
					Array.isArray(compactData.messages)
				) {
					out.push(...compactData.messages);
				} else if (
					ev.data &&
					typeof ev.data === "object" &&
					"role" in ev.data &&
					"content" in ev.data
				) {
					// compact_boundary Message: mutableMessages 仅 push 此 boundary。
					// 双重断言: 窄化后类型与 Message 不充分重叠 (缺 type/subtype 等字段),
					// 先 unknown 再 Message, 运行时 shape 由 recordTranscript 保证。
					out.push(ev.data as unknown as Message);
				}
				break;
			}
			case "turn_start":
			case "turn_end":
			case "error":
				// 非消息类, 不入 Message[]
				break;
		}
	}
	return out;
}

// dev 断言 — derived === mutableMessages。prod 早 return (byte-identical)。
// dev + env 开: drift 则 logForDebugging + throw (fail-visible)。每 turn 末调一次。
export function assertDualWrite(
	log: SessionEventLog,
	mutableMessages: Message[],
	turnId: string,
): void {
	// prod byte-identical: 非 dev 或 env 未设 → 零行为早 return。
	if (!isDevEnv() || !isEnvTruthy(process.env.FUSION_CODE_EVENT_SOURCING)) {
		return;
	}
	const derived = deriveMessages(log);
	try {
		deepStrictEqual(derived, mutableMessages);
	} catch {
		// drift: fail-visible in dev。log + throw (prod 不达, 早 return 已挡)。
		logForDebugging(
			`[event-sourcing] dual-write drift at turn ${turnId}: ` +
				`derived ${derived.length} vs mutable ${mutableMessages.length}`,
		);
		throw new Error(
			`dual-write drift at turn ${turnId}: derived !== mutableMessages ` +
				`(derived ${derived.length}, mutable ${mutableMessages.length})`,
		);
	}
}
