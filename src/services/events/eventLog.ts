// ar-plan PR #7 (S2.1): event sourcing — shadow write recorder.
//
// default-off (FUSION_CODE_EVENT_SOURCING=1). off = recorder no-op + empty log, byte-identical.
// mutableMessages remains the truth source; the event stream = shadow (write-only, not read; persistence = S2.3 later).
// fail-open: recorder wraps try/catch + log; a shadow-write throw never blocks the main path (Rule 12 declares the error but the main path stays fail-open).
// Attached to the QueryEngine instance (per-session); lifecycle = session.

import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import type {
	SessionEvent,
	SessionEventLog,
	SessionEventType,
} from "./SessionEvent.js";

// Master switch for the shadow write. off = all no-op, zero allocation, byte-identical.
export function isEventSourcingEnabled(): boolean {
	return isEnvTruthy(process.env.FUSION_CODE_EVENT_SOURCING);
}

// Pure-function append — immutable, returns a new log, original untouched (unit-testable, instance-free).
// Note: unit tests use this pure function; the recorder uses in-place push (appendEventInPlace) internally to avoid O(n²).
export function appendEvent(
	log: SessionEventLog,
	event: SessionEvent,
): SessionEventLog {
	return [...log, event];
}

// P1-10: in-place push variant (recorder use) — avoids appendEvent's O(n) copy of the whole log
// per append, which is O(n²) within a session (1000-msg ~8000 appends ~32M copies). Capped to
// prevent unbounded growth (default 50000 events, far beyond a single session's reasonable volume;
// on overflow drop the oldest and warn — the event stream is a shadow write never read on the main
// path, so this is acceptable).
export const MAX_EVENT_LOG_SIZE = 50000;
export function appendEventInPlace(
	log: SessionEventLog,
	event: SessionEvent,
): void {
	if (log.length >= MAX_EVENT_LOG_SIZE) {
		// Drop the oldest 10% to make room, avoiding a shift (O(n)) on every overflow.
		log.splice(0, Math.ceil(MAX_EVENT_LOG_SIZE * 0.1));
		logForDebugging(
			`[event-sourcing] event log cap reached (${MAX_EVENT_LOG_SIZE}); trimmed oldest 10%`,
		);
	}
	log.push(event);
}

// Shadow-write recorder — per-session bound turnId/sessionId, generates a monotonic seq.
// on = actually records; off = no-op (empty log). fail-open wraps the record body.
export class SessionEventRecorder {
	private readonly sessionId: string;
	private log: SessionEventLog = [];
	private seq = 0;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	// The switch is read here, not in the ctor — env can be toggled at runtime (test/debug). off = no-op.
	record(
		type: SessionEventType,
		data: unknown,
		opts?: { sourceEventSeqs?: number[] },
	): void {
		if (!isEventSourcingEnabled()) {
			return;
		}
		// fail-open: any shadow-write error (serialization/append) never blocks the main path.
		try {
			this.seq += 1;
			const event: SessionEvent = {
				seq: this.seq,
				type,
				data,
				sourceEventSeqs: opts?.sourceEventSeqs,
			};
			// P1-10: in-place push (not appendEvent spread) — avoids O(n²) copies; capped.
			appendEventInPlace(this.log, event);
		} catch (err) {
			// Rule 12 fail-visible: declares the error but the main path is not blocked (inherent to shadow writes).
			logForDebugging(
				`[event-sourcing] record failed for ${type} (sessionId=${this.sessionId}): ` +
					`${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// Read the log (S2.1: not used on the main path; tests/debug/deriveMessages in later PRs only).
	getLog(): SessionEventLog {
		return this.log;
	}

	// Record sourceEventSeqs (compact causation chain) — used by compact events.
	recordCompact(data: unknown, sourceEventSeqs: number[]): void {
		this.record("compact", data, { sourceEventSeqs });
	}
}

// Shared no-op recorder singleton for the off state — QueryEngine holds this when default-off, zero allocation.
// Unconditional no-op (unaffected by env), guaranteeing the off path stays byte-identical.
class NoopRecorder extends SessionEventRecorder {
	record(): void {
		// unconditional no-op — even if env flipped on mid-session
	}
	recordCompact(): void {
		// unconditional no-op
	}
}
export const NOOP_RECORDER: SessionEventRecorder = new NoopRecorder("__noop__");
