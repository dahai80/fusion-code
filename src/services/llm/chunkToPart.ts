// LLM seam — StreamChunk -> SDK part translator
//
// Phase 4 integration strategy: when the flag is on, adapter.stream() produces neutral
// StreamChunks, which this translator converts back into SDK part shape (the structure of
// BetaRawMessageStreamEvent) and feeds to claude.ts's existing switch
// (zero switch changes). With the flag off, the SDK is used; rollback = turn the flag off.
//
// The translation is the inverse mapping of sseToChunk, but usage uses Anthropic snake_case (required by updateUsage).
// Only constructs fields the switch actually reads; does not replicate the full SDK types (structural compatibility is enough).

import type { RawContentBlock, StreamChunk, TokenUsage } from "./types.js";

// SDK part shape (structural subset: the fields claude.ts's switch actually reads).
// Uses widened fields to avoid SDK type dependencies; the switch only discriminates on part.type and reads fields.
export type SdkPart = {
	type: string;
	[k: string]: unknown;
};

// camelCase TokenUsage -> Anthropic snake_case usage (for updateUsage).
function toAnthropicUsage(u: TokenUsage): Record<string, number> {
	const out: Record<string, number> = {
		input_tokens: u.inputTokens ?? 0,
		output_tokens: u.outputTokens ?? 0,
	};
	if (typeof u.cacheReadTokens === "number")
		out.cache_read_input_tokens = u.cacheReadTokens;
	if (typeof u.cacheWriteTokens === "number")
		out.cache_creation_input_tokens = u.cacheWriteTokens;
	return out;
}

// content_block_start's neutral RawContentBlock -> Anthropic content_block.
function toAnthropicBlock(b: RawContentBlock): Record<string, unknown> {
	const out: Record<string, unknown> = { type: b.type };
	if (typeof b.text === "string") out.text = b.text;
	if (typeof b.thinking === "string") out.thinking = b.thinking;
	if (typeof b.signature === "string") out.signature = b.signature;
	if (typeof b.id === "string") out.id = b.id;
	if (typeof b.name === "string") out.name = b.name;
	if (b.input !== undefined) out.input = b.input;
	return out;
}

// Single StreamChunk -> SDK part. Returning null means the chunk has no corresponding part (should not happen in theory).
export function chunkToSdkPart(
	chunk: StreamChunk,
	state: { lastUsage?: Record<string, number>; stopReason?: string },
): SdkPart | null {
	switch (chunk.type) {
		case "message-start": {
			const usage = chunk.usage
				? toAnthropicUsage(chunk.usage)
				: { input_tokens: 0, output_tokens: 0 };
			state.lastUsage = usage;
			return {
				type: "message_start",
				message: {
					id: "msg_seam",
					type: "message",
					role: "assistant",
					content: [],
					model: "",
					stop_reason: null,
					usage,
				},
			};
		}
		case "block-start": {
			return {
				type: "content_block_start",
				index: chunk.index,
				content_block: toAnthropicBlock(chunk.block),
			};
		}
		case "text-delta": {
			return {
				type: "content_block_delta",
				index: chunk.index,
				delta: { type: "text_delta", text: chunk.text },
			};
		}
		case "thinking-delta": {
			// signature_delta and thinking_delta are merged into thinking-delta at the neutral layer;
			// if a signature is present, restore it as a separate signature_delta part (the switch expects this).
			if (chunk.signature !== undefined && chunk.signature !== "") {
				return {
					type: "content_block_delta",
					index: chunk.index,
					delta: { type: "signature_delta", signature: chunk.signature },
				};
			}
			return {
				type: "content_block_delta",
				index: chunk.index,
				delta: { type: "thinking_delta", thinking: chunk.text },
			};
		}
		case "tool-call-delta": {
			return {
				type: "content_block_delta",
				index: chunk.index,
				delta: { type: "input_json_delta", partial_json: chunk.argumentsDelta },
			};
		}
		case "connector-delta": {
			return {
				type: "content_block_delta",
				index: chunk.index,
				delta: { type: "connector_text_delta", connector_text: chunk.text },
			};
		}
		case "block-end": {
			return { type: "content_block_stop", index: chunk.index };
		}
		case "usage": {
			const usage = toAnthropicUsage(chunk.usage);
			state.lastUsage = usage;
			if (chunk.stopReason) state.stopReason = chunk.stopReason;
			// log: stop_reason passes through only the actually received value; no "end_turn" fallback.
			// On abnormal stream truncation (no message_delta stop_reason) keep null so claude.ts's
			// !stopReason empty-response detection (claude.ts:2368) fires normally instead of masking it as a normal end.
			const stopReason = chunk.stopReason ?? state.stopReason ?? null;
			return {
				type: "message_delta",
				usage,
				delta: { stop_reason: stopReason },
			};
		}
		case "finish": {
			return { type: "message_stop" };
		}
		default:
			return null;
	}
}

// Convert the adapter's StreamChunk async stream wholesale into an SDK part async stream (consumed by claude.ts's for-await).
export async function* chunkStreamToSdkParts(
	chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<SdkPart> {
	const state: { lastUsage?: Record<string, number>; stopReason?: string } = {};
	for await (const chunk of chunks) {
		const part = chunkToSdkPart(chunk, state);
		if (part) yield part;
	}
}
