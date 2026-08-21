import { describe, expect, it } from "bun:test";
import type {
	AssistantMessage,
	Message,
	NormalizedMessage,
	UserMessage,
} from "../../types/message.js";
import { createUserMessage, normalizeMessages } from "../../utils/messages.js";
import {
	type NormalizedCacheState,
	normalizeMessagesIncremental,
} from "../../utils/normalizeMessagesCache.js";

// Helpers ---------------------------------------------------------------------

let uuidCounter = 0;
function makeUUID(prefix: string): string {
	uuidCounter++;
	const tail = String(uuidCounter).padStart(32 - prefix.length, "0");
	return `${prefix}${tail}`;
}

// Single-block assistant (text only). content.length === 1 → isNewChain stays false.
function makeAssistantText(
	uuid: string,
	text: string,
	timestamp = "2026-01-01T00:00:00.000Z",
): AssistantMessage {
	return {
		type: "assistant",
		uuid: uuid as AssistantMessage["uuid"],
		timestamp,
		message: {
			id: uuid,
			role: "assistant",
			model: "test-model",
			content: [{ type: "text", text }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as AssistantMessage["message"],
	};
}

// Multi-block assistant (tool_use + text). content.length === 2 → flips isNewChain.
function makeAssistantMulti(
	uuid: string,
	timestamp = "2026-01-01T00:00:00.000Z",
): AssistantMessage {
	return {
		type: "assistant",
		uuid: uuid as AssistantMessage["uuid"],
		timestamp,
		message: {
			id: uuid,
			role: "assistant",
			model: "test-model",
			content: [
				{ type: "tool_use", id: "tu-1", name: "Bash", input: { cmd: "ls" } },
				{ type: "text", text: "done" },
			],
			stop_reason: "tool_use",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		} as AssistantMessage["message"],
	};
}

function makeUserText(uuid: string, text: string): UserMessage {
	return createUserMessage({
		content: text,
		uuid,
		timestamp: "2026-01-01T00:00:00.000Z",
	});
}

function makeUserToolResult(uuid: string, toolUseId = "tu-1"): UserMessage {
	return createUserMessage({
		uuid,
		timestamp: "2026-01-01T00:00:00.000Z",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				content: "ok",
			},
		],
	});
}

// Compare two normalized arrays by uuid + content-type only (deep equality on
// derived UUIDs is the correctness crux; full deep-equal is noisy).
function uuidsOf(normalized: NormalizedMessage[]): string[] {
	return normalized.map((m) => m.uuid);
}

// -----------------------------------------------------------------------------

describe("normalizeMessagesIncremental", () => {
	it("baseline: cache=null equals full normalizeMessages output", () => {
		const messages: Message[] = [
			makeUserText(makeUUID("u-"), "hello"),
			makeAssistantText(makeUUID("a-"), "hi there"),
			makeAssistantMulti(makeUUID("b-")), // flips isNewChain, splits into 2
			makeUserToolResult(makeUUID("r-")),
		];
		const { normalized, cache } = normalizeMessagesIncremental(messages, null);
		const fresh = normalizeMessages(messages);

		expect(uuidsOf(normalized)).toEqual(uuidsOf(fresh));
		expect(normalized.length).toBe(fresh.length);
		// cache populated with per-source segment counts
		expect(cache.segmentCounts).toEqual([1, 1, 2, 1]);
		expect(cache.sourceRef.length).toBe(4);
	});

	it("incremental: append-only reuses prefix, only tail recomputed", () => {
		const base: Message[] = [
			makeUserText(makeUUID("u-"), "hello"),
			makeAssistantText(makeUUID("a-"), "hi"),
		];
		const first = normalizeMessagesIncremental(base, null);

		// Append a multi-block assistant (flips isNewChain) + its tool_result.
		const appended: Message[] = [
			...base,
			makeAssistantMulti(makeUUID("b-")),
			makeUserToolResult(makeUUID("r-")),
		];
		const second = normalizeMessagesIncremental(appended, first.cache);

		const fresh = normalizeMessages(appended);
		expect(uuidsOf(second.normalized)).toEqual(uuidsOf(fresh));

		// Prefix uuids must be byte-identical (reused, not recomputed).
		expect(
			uuidsOf(second.normalized.slice(0, first.normalized.length)),
		).toEqual(uuidsOf(first.normalized));
		expect(second.cache.segmentCounts).toEqual([1, 1, 2, 1]);
		// Reused prefix array identity kept.
		expect(second.cache.normalized).not.toBe(first.cache.normalized); // new array (concat)
	});

	it("isNewChain crosses cache boundary: seeded flag produces stable derived UUIDs", () => {
		// First batch ends with a multi-block assistant that flips isNewChain=true.
		const base: Message[] = [
			makeAssistantText(makeUUID("a-"), "text"), // content.length=1, stays false
			makeAssistantMulti(makeUUID("b-")), // flips true, splits → 2 blocks
		];
		const first = normalizeMessagesIncremental(base, null);
		expect(first.cache.isNewChain).toBe(true);

		// Append a single-block assistant. In a full recompute it now gets a
		// DERIVED uuid (isNewChain already true). The incremental path must
		// seed isNewChain=true and derive the same uuid.
		const tail: Message[] = [makeAssistantText(makeUUID("c-"), "after")];
		const appended = [...base, ...tail];
		const second = normalizeMessagesIncremental(appended, first.cache);
		const fresh = normalizeMessages(appended);

		expect(uuidsOf(second.normalized)).toEqual(uuidsOf(fresh));
		// The single appended assistant must have a derived uuid, not its own.
		const lastFresh = fresh.at(-1)!;
		const lastInc = second.normalized.at(-1)!;
		expect(lastInc.uuid).toBe(lastFresh.uuid);
		expect(lastInc.uuid).not.toBe(tail[0]!.uuid); // derived, not source
	});

	it("compact whole-array replace invalidates cache (prefix ref mismatch → full recompute)", () => {
		const base: Message[] = [
			makeUserText(makeUUID("u-"), "hello"),
			makeAssistantText(makeUUID("a-"), "hi"),
		];
		const first = normalizeMessagesIncremental(base, null);

		// Compact replaces the whole array with NEW object refs (even if the
		// first element textually looks the same, it's a different object).
		const compacted: Message[] = [
			makeUserText(makeUUID("z-"), "compacted summary"), // different uuid + object
			makeAssistantText(makeUUID("y-"), "ack"),
		];
		const second = normalizeMessagesIncremental(compacted, first.cache);
		const fresh = normalizeMessages(compacted);

		expect(uuidsOf(second.normalized)).toEqual(uuidsOf(fresh));
		// Cache fully rebuilt around the new source.
		expect(second.cache.sourceRef).not.toBe(first.cache.sourceRef);
		expect(second.cache.segmentCounts).toEqual([1, 1]);
	});

	it("partial prefix reuse: some head stable, middle replaced", () => {
		// Build cache over [u0, a0].
		const u0 = makeUserText(makeUUID("u-"), "0");
		const a0 = makeAssistantText(makeUUID("a-"), "0");
		const first = normalizeMessagesIncremental([u0, a0], null);

		// New array: [u0 (same ref), a1 (new), u2 (new)].
		const a1 = makeAssistantText(makeUUID("b-"), "1");
		const u2 = makeUserText(makeUUID("v-"), "2");
		const next: Message[] = [u0, a1, u2];
		const second = normalizeMessagesIncremental(next, first.cache);
		const fresh = normalizeMessages(next);

		// Only u0 reused (1 element); a1, u2 recomputed.
		expect(uuidsOf(second.normalized)).toEqual(uuidsOf(fresh));
		expect(second.normalized[0]!.uuid).toBe(u0.uuid); // reused prefix unchanged
		expect(second.cache.segmentCounts).toEqual([1, 1, 1]);
	});

	it("empty input + empty cache", () => {
		const { normalized, cache } = normalizeMessagesIncremental([], null);
		expect(normalized).toEqual([]);
		expect(cache.sourceRef).toEqual([]);
		expect(cache.segmentCounts).toEqual([]);
		expect(cache.normalized).toEqual([]);
		expect(cache.isNewChain).toBe(false);
	});

	it("segment counts correct for multi-block-only batch", () => {
		// Three multi-block assistants back to back → each splits into 2.
		const msgs: Message[] = [
			makeAssistantMulti(makeUUID("a-")),
			makeAssistantMulti(makeUUID("b-")),
			makeAssistantMulti(makeUUID("c-")),
		];
		const { normalized, cache } = normalizeMessagesIncremental(msgs, null);
		const fresh = normalizeMessages(msgs);

		expect(normalized.length).toBe(6); // 3 * 2
		expect(cache.segmentCounts).toEqual([2, 2, 2]);
		expect(uuidsOf(normalized)).toEqual(uuidsOf(fresh));
	});
});
