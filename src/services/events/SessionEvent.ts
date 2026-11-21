// ar-plan PR #7 (S2.1): event sourcing — SessionEvent types + serialization
// helper.
//
// First step of the P3 progressive migration: introduce event types +
// shadow write. mutableMessages remains the truth source, the event log is
// the shadow (write-only, never read). default-off
// (FUSION_CODE_EVENT_SOURCING=1).
// No persistence (S2.1 is in-memory only; persistence = S2.3 later).
// Pure types + helper, no runtime side effects.
//
// Follows architecture/fusion-code-enhance-arch-ecosystem-0827.md §2.2
// dual-write migration design.

// Event types — 8 kinds, covering turn lifecycle + message flow + compact +
// error.
// discriminated union: a later PR (S2.2) refines per-type data; this PR uses
// data: unknown.
export type SessionEventType =
	| "user_message"
	| "assistant_message"
	| "tool_use"
	| "tool_result"
	| "compact"
	| "error"
	| "turn_start"
	| "turn_end";

// Single event. seq = monotonically increasing in-memory counter (not
// Date.now — scripts forbid time sources).
// sourceEventSeqs = causation chain (compact events point at the seqs of the
// compacted events).
// surfaceOp field removed (audit P2-2/R18): write-only dead field, 0
// production readers.
export interface SessionEvent {
	seq: number;
	type: SessionEventType;
	data: unknown;
	sourceEventSeqs?: number[];
}

// Event log = ordered event array (in-memory, per-session).
export type SessionEventLog = SessionEvent[];

// Serialization helper — pure function, JSON-serializable (no circular
// references, data must be serializable).
// When persisting (S2.3), just JSON.stringify(serializeLog(log)).
export function serializeLog(log: SessionEventLog): string {
	return JSON.stringify(log);
}
