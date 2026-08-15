// LLM 接缝 — StreamChunk -> SDK part 翻译器
//
// Phase 4 接入策略: flag 开时用 adapter.stream() 产出中立 StreamChunk, 再经本翻译器
// 转回 SDK part 形状 (BetaRawMessageStreamEvent 的结构), 喂给 claude.ts 现有 switch
// (零改 switch)。flag 关时走 SDK, 回滚=关 flag。
//
// 翻译是 sseToChunk 的逆映射, 但 usage 用 Anthropic snake_case (updateUsage 需要)。
// 只构造 switch 实际读取的字段, 不复刻完整 SDK 类型 (结构兼容即可)。

import type { RawContentBlock, StreamChunk, TokenUsage } from "./types.js";

// SDK part 形状 (结构子集, claude.ts switch 实际读取的字段)。
// 用宽化字段避免引入 SDK 类型依赖; switch 只做 part.type 判别 + 字段读取。
export type SdkPart = {
	type: string;
	[k: string]: unknown;
};

// camelCase TokenUsage -> Anthropic snake_case usage (供 updateUsage)。
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

// content_block_start 的中立 RawContentBlock -> Anthropic content_block。
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

// 单个 StreamChunk -> SDK part。返回 null 表示该 chunk 无对应 part (理论上不发生)。
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
			// signature_delta 与 thinking_delta 在中立层合并为 thinking-delta;
			// 若带 signature, 还原成单独的 signature_delta part (switch 期望如此)。
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
			return {
				type: "message_delta",
				usage,
				delta: {
					stop_reason: chunk.stopReason ?? state.stopReason ?? "end_turn",
				},
			};
		}
		case "finish": {
			return { type: "message_stop" };
		}
		default:
			return null;
	}
}

// 把 adapter 的 StreamChunk 异步流整体转成 SDK part 异步流 (claude.ts for-await 消费)。
export async function* chunkStreamToSdkParts(
	chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<SdkPart> {
	const state: { lastUsage?: Record<string, number>; stopReason?: string } = {};
	for await (const chunk of chunks) {
		const part = chunkToSdkPart(chunk, state);
		if (part) yield part;
	}
}
