// log: stub for TS2307 — sessionTranscript feature-gated module

import type { Message } from "../../types/message.js";

export function flushOnDateChange(
	_messages: Message[],
	_currentDate: string,
): void {
	// log: stub — no-op in non-internal builds
}
