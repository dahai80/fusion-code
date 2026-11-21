// LLM adapter seam — Anthropic Wire Adapter
//
// Translates provider-neutral GenerateOptions into the POST /v1/messages
// JSON body, and translates the SSE event stream (produced by parseSseStream)
// into provider-neutral StreamChunks.
// Replaces @anthropic-ai/sdk's beta.messages.create({stream:true}) +
// BetaMessageStream.
//
// This adapter only does protocol translation, no domain logic
// (contentBlocks accumulation / usage merging / stop_reason handling stays
// in the claude.ts main loop; Phase 4 switched its switch from SDK parts to
// consuming StreamChunks).
//
// Request-body field mapping is based on the actual shape of
// src/services/api/claude.ts:1539 paramsFromContext.

import { type PostMessagesOptions, postMessages } from "./httpClient.js";
import { parseSseStream } from "./sseStream.js";
import type {
	FinishReason,
	GenerateOptions,
	LlmAdapter,
	NeutralContentBlock,
	NeutralMessage,
	NeutralSystemBlock,
	RawContentBlock,
	StreamChunk,
	ToolSchema,
} from "./types.js";

// Translate NeutralMessage[] into an Anthropic messages array (string content
// passed through, block arrays mapped by type; tool_result content passed
// through).
function toAnthropicMessages(
	messages: NeutralMessage[],
): Record<string, unknown>[] {
	return messages.map((m) => {
		if (typeof m.content === "string") {
			return { role: m.role, content: m.content };
		}
		const blocks = m.content.map(toAnthropicBlock);
		return { role: m.role, content: blocks };
	});
}

// Single NeutralContentBlock -> Anthropic content block.
function toAnthropicBlock(b: NeutralContentBlock): Record<string, unknown> {
	switch (b.type) {
		case "text":
			return { type: "text", text: b.text };
		case "thinking":
			return {
				type: "thinking",
				thinking: b.thinking,
				...(b.signature !== undefined && { signature: b.signature }),
			};
		case "tool_use":
			// input may be a string (partial JSON) or an object; passed through to
			// the server
			return {
				type: "tool_use",
				id: b.id,
				name: b.name,
				input: b.input,
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id: b.tool_use_id,
				content: b.content,
				...(b.is_error !== undefined && { is_error: b.is_error }),
			};
	}
}

function toAnthropicTool(t: ToolSchema): Record<string, unknown> {
	return {
		name: t.name,
		description: t.description,
		input_schema: t.parameters,
	};
}

// Translate GenerateOptions into a /v1/messages request body.
// Only maps fields the neutral types can express; extension fields like
// betas/metadata/tool_choice/output_config/speed/context_management are
// passed through by the caller via extraBody (added at Phase 4 integration).
export function buildRequestBody(
	options: GenerateOptions,
	extraBody?: Record<string, unknown>,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: options.model,
		messages: toAnthropicMessages(options.messages),
		max_tokens: options.maxTokens ?? 4096,
		stream: true,
	};
	if (options.system !== undefined) {
		body.system =
			typeof options.system === "string"
				? options.system
				: options.system.map((b: NeutralSystemBlock) => ({
						type: "text",
						text: b.text,
						...(b.cache_control !== undefined && {
							cache_control: b.cache_control,
						}),
					}));
	}
	if (options.tools && options.tools.length > 0) {
		body.tools = options.tools.map(toAnthropicTool);
	}
	if (options.temperature !== undefined) {
		body.temperature = options.temperature;
	}
	if (options.stop && options.stop.length > 0) {
		body.stop_sequences = options.stop;
	}
	if (options.thinking && options.thinking.type === "enabled") {
		body.thinking = {
			type: "enabled",
			budget_tokens: options.thinking.budgetTokens,
		};
	}
	if (extraBody) {
		Object.assign(body, extraBody);
	}
	return body;
}

// Accumulated state for SSE translation (module-internal only, holds the
// latest usage and stop_reason).
export interface SseState {
	lastUsage?: { inputTokens: number; outputTokens: number };
	stopReason?: string;
}

// content_block_start's content_block -> RawContentBlock (neutral).
function toRawBlock(block: Record<string, unknown>): RawContentBlock {
	const type = (block.type as string) ?? "text";
	const out: RawContentBlock = {
		type: type as RawContentBlock["type"],
	};
	if (typeof block.text === "string") out.text = block.text;
	if (typeof block.thinking === "string") out.thinking = block.thinking;
	if (typeof block.signature === "string") out.signature = block.signature;
	if (typeof block.id === "string") out.id = block.id;
	if (typeof block.name === "string") out.name = block.name;
	// tool_use's input is often {} at block-start; accumulation is done by
	// input_json_delta
	if (block.input !== undefined) out.input = block.input as string;
	return out;
}

function usageFrom(u: unknown): { inputTokens: number; outputTokens: number } {
	const r = (u ?? {}) as {
		input_tokens?: number;
		output_tokens?: number;
	};
	return {
		inputTokens: r.input_tokens ?? 0,
		outputTokens: r.output_tokens ?? 0,
	};
}

// Infer FinishReason from stop_reason.
function toFinishReason(stopReason: string | undefined): FinishReason {
	switch (stopReason) {
		case "end_turn":
		case "tool_use":
		case "max_tokens":
		case "stop_sequence":
			return stopReason;
		case "model_context_window_exceeded":
			return "max_tokens";
		default:
			return "end_turn";
	}
}

// SSE event data (JSON string) -> StreamChunk. Returns null to ignore
// (ping/citations etc.).
// Event types and fields follow the claude.ts:1975 switch.
// Exported so unit tests can verify the SSE->chunk mapping directly (no
// network involved).
export function sseToChunk(
	event: string,
	data: string,
	state: SseState,
): StreamChunk | null {
	let p: Record<string, unknown> = {};
	if (data !== "") {
		try {
			p = JSON.parse(data) as Record<string, unknown>;
		} catch {
			// log: non-JSON error events must still throw (the SDK fell back to
			// safeJSON ?? raw); other events (message_start etc.) are ignored on
			// parse failure, preserving the original behavior.
			if (event === "error") {
				const thrown = new Error(data || "stream error");
				thrown.name = "APIError";
				throw thrown;
			}
			return null;
		}
	}

	switch (event) {
		case "message_start": {
			const message = (p.message ?? {}) as Record<string, unknown>;
			if (message.usage) state.lastUsage = usageFrom(message.usage);
			return {
				type: "message-start",
				usage: state.lastUsage,
			};
		}
		case "content_block_start": {
			const index = (p.index as number) ?? 0;
			const block = (p.content_block ?? {}) as Record<string, unknown>;
			return {
				type: "block-start",
				index,
				block: toRawBlock(block),
			};
		}
		case "content_block_delta": {
			const index = (p.index as number) ?? 0;
			const delta = (p.delta ?? {}) as Record<string, unknown>;
			switch (delta.type as string) {
				case "text_delta":
					return {
						type: "text-delta",
						index,
						text: (delta.text as string) ?? "",
					};
				case "thinking_delta":
					return {
						type: "thinking-delta",
						index,
						text: (delta.thinking as string) ?? "",
					};
				case "signature_delta":
					// signature folds into the thinking block; zero-width
					// thinking-delta carries the signature
					return {
						type: "thinking-delta",
						index,
						text: "",
						signature: (delta.signature as string) ?? "",
					};
				case "input_json_delta":
					return {
						type: "tool-call-delta",
						index,
						argumentsDelta: (delta.partial_json as string) ?? "",
					};
				case "connector_text_delta":
					return {
						type: "connector-delta",
						index,
						text: (delta.connector_text as string) ?? "",
					};
				default:
					return null;
			}
		}
		case "content_block_stop":
			return { type: "block-end", index: (p.index as number) ?? 0 };
		case "message_delta": {
			const usage = p.usage
				? usageFrom(p.usage)
				: (state.lastUsage ?? { inputTokens: 0, outputTokens: 0 });
			state.lastUsage = usage;
			const delta = (p.delta ?? {}) as Record<string, unknown>;
			let stopReason: string | undefined;
			if (typeof delta.stop_reason === "string") {
				state.stopReason = delta.stop_reason;
				stopReason = delta.stop_reason;
			}
			return { type: "usage", usage, stopReason };
		}
		case "message_stop":
			return { type: "finish", reason: toFinishReason(state.stopReason) };
		case "ping":
			return null;
		case "error": {
			// log: in-stream error event — the SDK threw APIError for this at
			// core/streaming.js:62, and withRetry retries/classifies based on it.
			// Throwing here too prevents mid-stream errors from being silently
			// swallowed, which would truncate the stream without a finish.
			// Error body looks like
			// {"type":"error","error":{"type":"overloaded_error","message":"..."}}.
			const errBody = p as {
				error?: { type?: string; message?: string };
				message?: string;
			};
			const msg =
				errBody?.error?.message ?? errBody?.message ?? data ?? "stream error";
			const thrown = new Error(msg) as Error & { status?: number };
			thrown.name = "APIError";
			// Pass through status (if present) for withRetry's isApiErrorLike +
			// classifyByStatus retry classification.
			if (typeof p.status === "number") thrown.status = p.status;
			throw thrown;
		}
		default:
			return null;
	}
}

// Anthropic Wire Adapter — POST /v1/messages via httpClient, SSE -> StreamChunk.
export class AnthropicWireAdapter implements LlmAdapter {
	private readonly postOpts: Omit<PostMessagesOptions, "body" | "signal">;

	constructor(postOpts: Omit<PostMessagesOptions, "body" | "signal">) {
		this.postOpts = postOpts;
	}

	providerInfo(): { id: string; name: string } {
		return { id: "anthropic", name: "Anthropic" };
	}

	async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
		const body = buildRequestBody(options);
		const { response } = await postMessages({
			...this.postOpts,
			body: JSON.stringify(body),
			signal: options.signal,
		});
		if (!response.body) {
			throw new Error("AnthropicWireAdapter: response body missing");
		}
		const state: SseState = {};
		for await (const evt of parseSseStream(response.body, options.signal)) {
			const chunk = sseToChunk(evt.event, evt.data, state);
			if (chunk) yield chunk;
		}
	}
}

// Seam switch: the new adapter path is active only when the
// LLM_ADAPTER_SEAM feature is on.
// When off (default) the SDK path runs and the related code is DCE'd away.
// Note: feature() is a Bun bundle DCE macro — it can only be used directly in
// an if/ternary, not wrapped in a function that returns it (otherwise it
// throws at runtime). Callers must write feature("LLM_ADAPTER_SEAM")
// directly.
