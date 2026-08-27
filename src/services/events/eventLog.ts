// ar-plan PR #7 (S2.1): 事件溯源 — 旁路写管理器 (shadow write recorder)。
//
// default-off (FUSION_CODE_EVENT_SOURCING=1)。off = recorder no-op + 空 log, byte-identical。
// mutableMessages 仍真源; 事件流 = 影子 (只写不读, 落盘 = S2.3 远期)。
// fail-open: recorder 内 try/catch + log, 旁路写抛错不阻断主路径 (Rule 12 声明但 fail-open 主路径)。
// 挂 QueryEngine 实例 (per-session), 生命周期 = 会话。

import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import type {
	SessionEvent,
	SessionEventLog,
	SessionEventType,
} from "./SessionEvent.js";

// 旁路写总开关。off = 全 no-op, 零分配, byte-identical。
export function isEventSourcingEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_EVENT_SOURCING);
}

// 纯函数 append — 不可变, 返新 log, 原 log 不动 (可单测, 不依赖实例)。
// 注意: 单测用此纯函数; recorder 内部走原地 push (appendEventInPlace) 避免 O(n²)。
export function appendEvent(
	log: SessionEventLog,
	event: SessionEvent,
): SessionEventLog {
	return [...log, event];
}

// P1-10: 原地 push 版 (recorder 用) — 避免 appendEvent 每次 spread 整 log 的 O(n) 拷贝,
// 会话内 O(n²) (1000-msg ~8000 append ~32M 拷贝)。带上限防无界增长 (默认 50000 事件,
// 远超单会话合理量, 溢出丢最旧并告警 — 事件流本为影子写不读主路径, 可接受)。
export const MAX_EVENT_LOG_SIZE = 50000;
export function appendEventInPlace(
	log: SessionEventLog,
	event: SessionEvent,
): void {
	if (log.length >= MAX_EVENT_LOG_SIZE) {
		// 丢最旧 10% 腾空间, 避免每次溢出都 shift (O(n))。
		log.splice(0, Math.ceil(MAX_EVENT_LOG_SIZE * 0.1));
		logForDebugging(
			`[event-sourcing] event log cap reached (${MAX_EVENT_LOG_SIZE}); trimmed oldest 10%`,
		);
	}
	log.push(event);
}

// 旁路写记录器 — per-session 绑 turnId/sessionId, 生成单调 seq。
// on = 真 record; off = no-op (空 log)。fail-open 包 record body。
export class SessionEventRecorder {
	private readonly sessionId: string;
	private log: SessionEventLog = [];
	private seq = 0;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	// 开关在此读, 非 ctor — env 可运行时切 (测/调试)。off = no-op。
	record(
		type: SessionEventType,
		data: unknown,
		opts?: { surfaceOp?: string; sourceEventSeqs?: number[] },
	): void {
		if (!isEventSourcingEnabled()) {
			return;
		}
		// fail-open: 旁路写任何错 (序列化/append) 不阻断主路径。
		try {
			this.seq += 1;
			const event: SessionEvent = {
				seq: this.seq,
				type,
				data,
				surfaceOp: opts?.surfaceOp,
				sourceEventSeqs: opts?.sourceEventSeqs,
			};
			// P1-10: 原地 push (非 appendEvent spread) — 避免 O(n²) 拷贝; 带上限。
			appendEventInPlace(this.log, event);
		} catch (err) {
			// Rule 12 fail-visible: 声明错但主路径不阻断 (旁路写性质决定)。
			logForDebugging(
				`[event-sourcing] record failed for ${type} (sessionId=${this.sessionId}): ` +
					`${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// 读取日志 (S2.1 不用于主路径; 仅测/调试/后续 PR deriveMessages)。
	getLog(): SessionEventLog {
		return this.log;
	}

	// 记录 sourceEventSeqs (compact causation 链) — compact 事件用。
	recordCompact(
		data: unknown,
		sourceEventSeqs: number[],
		surfaceOp?: string,
	): void {
		this.record("compact", data, { surfaceOp, sourceEventSeqs });
	}
}

// 关闭态共享单例 no-op recorder — 默认 off 时 QueryEngine 持此, 零分配。
// 无条件 no-op (不受 env 影响), 保证 off 路径 byte-identical。
class NoopRecorder extends SessionEventRecorder {
	record(): void {
		// unconditional no-op — even if env flipped on mid-session
	}
	recordCompact(): void {
		// unconditional no-op
	}
}
export const NOOP_RECORDER: SessionEventRecorder = new NoopRecorder("__noop__");
