// ar-plan PR #8 (S2.2): event sourcing — deriveMessages projection + assertDualWrite dev assertion.
//
// Adds a projection on top of the shadow writes: deriveMessages(log) rebuilds Message[]. The dev assertion derived === mutableMessages
// verifies the event stream is complete. **Reads are still not switched** (prod does not read the log; the projection serves dev assertion + unit tests only).
// prod byte-identical: assertDualWrite returns early when not dev or env unset.

import { deepStrictEqual } from "node:assert";
import type { Message } from "../../types/message.js";
import { isDevEnv } from "../../utils/buildConstants.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import type { SessionEventLog } from "./SessionEvent.js";

// Projection — rebuilds Message[] from the event stream. Pure function, unit-testable.
// Message events (user_message/assistant_message/tool_result) → data is the Message itself.
// compact events = boundaries (prefix replacement, see arch-ecosystem §2.2): encountering compact in order
// truncates and rebuilds everything after it (the events after compact are the truth source of post-compact mutableMessages).
// turn_start/turn_end/error → not messages, skipped. Out-of-order seq input → sorted by seq on output.
export function deriveMessages(log: SessionEventLog): Message[] {
	const sorted = [...log].sort((a, b) => a.seq - b.seq);
	const out: Message[] = [];
	for (const ev of sorted) {
		switch (ev.type) {
			case "user_message":
			case "assistant_message":
			case "tool_result": {
				// data = pushed Message (single) or Message[] (user_message spread).
				// Unit tests guarantee the data shape; the projection flattens arrays.
				if (Array.isArray(ev.data)) {
					for (const m of ev.data as Message[]) out.push(m);
				} else {
					out.push(ev.data as Message);
				}
				break;
			}
			case "compact": {
				// compact boundary: truncate everything accumulated before; events after compact rebuild = new truth source.
				// P1-3: compact data carries the replacement state, otherwise assertDualWrite gives a false positive on every compaction
				// (mutableMessages=[boundary] but derived=[] → dev never catches real drift).
				// Two shapes: snipResult {executed, messages} → re-seed out = messages;
				//   compact_boundary Message → out = [that boundary] (mutable pushes only the boundary).
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
					// compact_boundary Message: mutableMessages pushes only this boundary.
					// Double assertion: the narrowed type does not sufficiently overlap Message (missing type/subtype and other fields),
					// so cast to unknown first then Message; runtime shape is guaranteed by recordTranscript.
					out.push(ev.data as unknown as Message);
				}
				break;
			}
			case "turn_start":
			case "turn_end":
			case "error":
				// Not a message type, not included in Message[]
				break;
		}
	}
	return out;
}

// Dev assertion — derived === mutableMessages. Early return in prod (byte-identical).
// dev + env on: on drift, logForDebugging + throw (fail-visible). Called once at the end of each turn.
// P3-1: checks whether the recorder is the noop instance, not the env — after a runtime env flip, an off session holds
// NOOP_RECORDER (empty log); if only env were checked (on), derived([]) !== mutableMessages would
// throw a false drift. Short-circuiting the noop recorder is the correct behavior (an off session never asserts regardless of the env's current value).
export function assertDualWrite(
	log: SessionEventLog,
	mutableMessages: Message[],
	turnId: string,
	isNoopRecorder = false,
): void {
	// prod byte-identical: not dev or env unset → zero-behavior early return.
	if (!isDevEnv() || !isEnvTruthy(process.env.FUSION_CODE_EVENT_SOURCING)) {
		return;
	}
	// P3-1: noop recorder (off session) short-circuit — its log is always empty, so the assertion would always false-drift.
	if (isNoopRecorder) {
		return;
	}
	const derived = deriveMessages(log);
	try {
		deepStrictEqual(derived, mutableMessages);
	} catch {
		// drift: fail-visible in dev. log + throw (unreachable in prod; early return already guards).
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
