import type { Message, NormalizedMessage } from "../types/message.js";
import { normalizeMessagesCore } from "./messages.js";

// Incremental cache for normalizeMessages output, keyed by reference identity
// of the source messages array prefix. See item 5 (CC 2.1.216/203, §187).
//
// Why reference-identity is safe here:
//  - `messages` is strictly append-only during a turn. Streaming content-block
//    deltas go to a separate `streamingToolUses` state (not `messages`); a full
//    assistant message is appended atomically at stream end via the immutable
//    setMessages((prev) => [...prev, newMsg]). So an existing message object's
//    reference is stable, and a new turn only appends to the tail.
//  - Compact / rewind / clear replace the whole array (new object refs), so the
//    prefix references stop matching and the cache falls back to a full
//    recompute — no explicit invalidation, no stale output.
//  - normalizeMessages' only mutable state is the monotonic `isNewChain` flag
//    (false→true, set by any message with content.length > 1) and the
//    deterministic deriveUUID(parentUUID, index). Seeding the flag from the
//    cached prefix's final value lets a tail-only recompute produce identical
//    UUIDs to a full recompute.
//
// One source message can flatMap to N normalized messages (a multi-block
// assistant message splits into one message per block), so we track the
// per-source segment count to align the reused normalized prefix. We can't
// just slice by source length.

export interface NormalizedCacheState {
	// Snapshot of the source array elements by identity. We compare
	// messages[i] === sourceRef[i] to find the stable prefix length.
	sourceRef: Message[];
	// segmentCounts[i] = number of normalized messages produced from sourceRef[i].
	// sum(segmentCounts[0..k)) is the cutoff into `normalized` for a k-length
	// stable prefix.
	segmentCounts: number[];
	// Full unfiltered normalized output for sourceRef. The caller applies
	// isNotEmptyMessage after; keeping the cache pre-filter keeps segment
	// alignment exact (filtering would shift indices).
	normalized: NormalizedMessage[];
	// Value of isNewChain after processing all of sourceRef. Used to seed the
	// tail recompute so derived UUIDs stay stable.
	isNewChain: boolean;
}

export function normalizeMessagesIncremental(
	messages: Message[],
	cache: NormalizedCacheState | null,
): { normalized: NormalizedMessage[]; cache: NormalizedCacheState } {
	// No cache or empty cache: full recompute from index 0.
	if (!cache || cache.sourceRef.length === 0) {
		return computeFresh(messages, 0, false);
	}

	// Find the longest prefix of `messages` whose element references match the
	// cached snapshot. Append-only guarantees matched elements are unchanged.
	const maxSourceLen = Math.min(messages.length, cache.sourceRef.length);
	let prefixLen = 0;
	while (
		prefixLen < maxSourceLen &&
		messages[prefixLen] === cache.sourceRef[prefixLen]
	) {
		prefixLen++;
	}

	// Whole-array replace (compact/rewind/clear) or the first element itself
	// changed: no reusable prefix → full recompute.
	if (prefixLen === 0) {
		return computeFresh(messages, 0, false);
	}

	// Reuse the cached normalized prefix up to the aligned cutoff.
	let cutoff = 0;
	for (let i = 0; i < prefixLen; i++) {
		cutoff += cache.segmentCounts[i]!;
	}

	// If the entire source array is unchanged (same length, full prefix match),
	// the cached normalized output is still valid — return it verbatim. This
	// covers re-renders where `messages` is a new array wrapper over the same
	// element refs (e.g. useDeferredValue transitions, parent re-render).
	if (prefixLen === messages.length && prefixLen === cache.sourceRef.length) {
		return {
			normalized: cache.normalized,
			cache, // unchanged state
		};
	}

	// Append: reuse prefix, recompute only the tail with the seeded flag.
	const reused = cache.normalized.slice(0, cutoff);
	const tail = messages.slice(prefixLen);
	const seedIsNewChain = cache.isNewChain;
	const { normalized: tailNormalized, isNewChain } = normalizeMessagesCore(
		tail,
		seedIsNewChain,
	);

	const normalized =
		tailNormalized.length === 0 ? reused : reused.concat(tailNormalized);

	// Build the new cache state.
	const sourceRef =
		messages.length === cache.sourceRef.length ? messages : messages.slice();
	const segmentCounts: number[] = new Array(messages.length);
	for (let i = 0; i < prefixLen; i++) {
		segmentCounts[i] = cache.segmentCounts[i]!;
	}
	for (let i = prefixLen; i < messages.length; i++) {
		// Recompute the segment count for each tail source message from the
		// fresh tailNormalized output. We re-derive by re-normalizing each tail
		// source message individually — cheap (tail is small) and exact.
		const one = normalizeMessagesCore(
			[messages[i]!],
			isNewChainBeforeTail(seedIsNewChain, tailNormalized, tail, i - prefixLen),
		).normalized.length;
		segmentCounts[i] = one;
	}

	return {
		normalized,
		cache: { sourceRef, segmentCounts, normalized, isNewChain },
	};
}

// Full recompute with no prefix reuse. startIndex is always 0 today; kept as a
// parameter for clarity (the fallback path always recomputes the whole array).
function computeFresh(
	messages: Message[],
	_startIndex: number,
	seedIsNewChain: boolean,
): { normalized: NormalizedMessage[]; cache: NormalizedCacheState } {
	const { normalized, isNewChain } = normalizeMessagesCore(
		messages,
		seedIsNewChain,
	);
	const segmentCounts: number[] = new Array(messages.length);
	// Derive each source message's segment count by normalizing the prefix up
	// to and including it with the running isNewChain value. This mirrors the
	// flatMap expansion exactly.
	let runningFlag = seedIsNewChain;
	let runningCount = 0;
	for (let i = 0; i < messages.length; i++) {
		const before = runningCount;
		const seg = normalizeMessagesCore([messages[i]!], runningFlag);
		runningFlag = seg.isNewChain;
		runningCount += seg.normalized.length;
		segmentCounts[i] = runningCount - before;
	}
	return {
		normalized,
		cache: {
			sourceRef: messages.slice(),
			segmentCounts,
			normalized,
			isNewChain,
		},
	};
}

// Determine the isNewChain value that was in effect just before processing the
// tail source message at `tailIndex`. The tail was recompute-seeded with
// seedIsNewChain; as we walk the tail, each message may flip the flag. We
// replay that flip by re-counting flips among earlier tail messages.
function isNewChainBeforeTail(
	seedIsNewChain: boolean,
	_tailNormalized: NormalizedMessage[],
	tail: Message[],
	tailIndex: number,
): boolean {
	let flag = seedIsNewChain;
	for (let i = 0; i < tailIndex; i++) {
		const m = tail[i]!;
		if (
			(m.type === "assistant" || m.type === "user") &&
			typeof m.message.content !== "string" &&
			m.message.content.length > 1
		) {
			flag = true;
		}
	}
	return flag;
}
