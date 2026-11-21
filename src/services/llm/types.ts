// LLM adapter seam — provider-neutral types (modeled on deepseek-harness
// LlmAdapter)
//
// This is the core abstraction layer of fusion-code's de-SDK'd Anthropic
// stack. All providers (fusion-mlx / firstParty / openai / foundry / bedrock
// / vertex) translate wire messages into the neutral chunks below through
// their own LlmAdapter.
// The main call loop (src/services/api/claude.ts) consumes
// AsyncIterable<StreamChunk>, no longer instanceof-ing SDK types.
//
// Design basis: claude.ts's existing switch(part.type) consumes Anthropic
// SSE events; these types map to it one-for-one.

// ─── Content block types ─────────────────────────────────────────────
// Neutral content block tags, aligned with Anthropic content_block.type so
// adapters can map with zero loss.
export type ContentBlockType =
	| "text"
	| "thinking"
	| "tool_use"
	| "server_tool_use"
	| "tool_result"
	| "connector_text";

// ─── Token usage ─────────────────────────────────────────────
// cache fields are optional: present only when the provider reports non-zero
// (modeled on dsh TokenUsage).
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
}

// ─── Streaming chunks ─────────────────────────────────────────────
// Adapters stream a single model call out as the chunks below. The block
// index ties interleaved deltas to the same block.
// Maps one-for-one onto claude.ts's existing Anthropic SSE event switch
// branches:
//   message-start      ← message_start (carries initial usage / ttft)
//   block-start        ← content_block_start
//   text-delta         ← content_block_delta (text_delta)
//   thinking-delta     ← content_block_delta (thinking_delta / signature_delta)
//   tool-call-delta    ← content_block_delta (input_json_delta)
//   connector-delta    ← content_block_delta (connector_text_delta)
//   block-end          ← content_block_stop
//   usage              ← message_delta.usage
//   finish             ← message_stop (+ stop_reason → FinishReason)
export type StreamChunk =
	| { type: "message-start"; usage?: TokenUsage }
	| { type: "block-start"; index: number; block: RawContentBlock }
	| { type: "text-delta"; index: number; text: string }
	| { type: "thinking-delta"; index: number; text: string; signature?: string }
	| { type: "tool-call-delta"; index: number; argumentsDelta: string }
	| { type: "connector-delta"; index: number; text: string }
	| { type: "block-end"; index: number }
	| { type: "usage"; usage: TokenUsage; stopReason?: string }
	| { type: "finish"; reason: FinishReason };

// Raw content block carried by block-start (expanded fields, not SDK types).
// Adapters copy it verbatim from the provider wire; the main loop dispatches
// accumulation by type.
export interface RawContentBlock {
	type: ContentBlockType;
	// text/thinking blocks
	text?: string;
	thinking?: string;
	signature?: string;
	// tool_use / server_tool_use blocks
	id?: string;
	name?: string;
	input?: string | Record<string, unknown>;
	// tool_result blocks
	toolUseId?: string;
	content?: unknown;
	isError?: boolean;
	// Pass through unrecognized fields (server extensions like
	// advisor_tool_result)
	[extra: string]: unknown;
}

// ─── Finish reasons ───────────────────────────────────────────────
// Modeled on dsh FinishReasonMap: stable neutral codes, not the SDK's
// stop_reason strings.
export type FinishReason =
	| "end_turn"
	| "tool_use"
	| "max_tokens"
	| "stop_sequence"
	| "aborted"
	| "error";

// ─── Failures ───────────────────────────────────────────────────
// Provider-neutral failure facts (modeled on dsh LlmFailure). Replaces
// instanceof APIError detection.
// code is a stable machine-routing code; withRetry/errors use it for retry
// decisions/classification.
export type LlmErrorCode =
	| "AUTH"
	| "RATE_LIMIT"
	| "INVALID_REQUEST"
	| "SERVER"
	| "TIMEOUT"
	| "TRANSPORT"
	| "ABORTED"
	// audit 2.2.1 (CRITICAL): deterministic errors (MLX OOM / model_not_found
	// / unrecognized fallback) classify as
	// UNKNOWN — not retryable. The old classifyByMessage fallback returned
	// "SERVER", treating every unmatched message as retryable 10× — a
	// self-inflicted DoS against a shared MLX service (memory limit exceeded /
	// Reduce context size / model not found are all deterministic; retrying
	// always reproduces them).
	| "UNKNOWN";

// Headers shape compatible with the SDK's APIError.headers (supports
// .get(name)) and bare objects (supports ["retry-after"]).
// httpClient can attach the fetch Response.headers (native Headers, which
// already has .get) directly.
export type LlmFailureHeaders = {
	get?(name: string): string | null;
} & {
	[header: string]: string | undefined;
};

export interface LlmFailure {
	code: LlmErrorCode;
	message: string;
	status?: number;
	providerRetryAfterMs?: number;
	requestId?: string;
	// Non-2xx response headers (source of rate-limit/retry headers). The fetch
	// exception path has no response, left undefined.
	headers?: LlmFailureHeaders;
}

// ─── Tool schema ────────────────────────────────────────────
// Tool description sent to the model (JSON Schema parameters). Aligned with
// dsh ToolSchema.
export interface ToolSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

// ─── Request options ───────────────────────────────────────────────
// A fully assembled model request (modeled on dsh GenerateOptions).
// messages is the neutral structure (same shape as Anthropic MessageParam:
// role + content).
// The adapter maps it to the provider wire format.
export interface GenerateOptions {
	model: string;
	messages: NeutralMessage[];
	system?: string | NeutralSystemBlock[];
	tools?: ToolSchema[];
	temperature?: number;
	maxTokens?: number;
	stop?: string[];
	thinking?: { type: "enabled"; budgetTokens: number } | { type: "disabled" };
	signal?: AbortSignal;
	// Request-origin marker, passed through to the adapter for routing/logging
	// (e.g. compaction / session-title auxiliary calls).
	purpose?: "compaction" | "session-title" | "main";
}

export interface NeutralMessage {
	role: "user" | "assistant";
	content: string | NeutralContentBlock[];
}

export type NeutralContentBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; signature?: string }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown> | string;
	  }
	| {
			type: "tool_result";
			tool_use_id: string;
			content: unknown;
			is_error?: boolean;
	  };

export type NeutralSystemBlock = {
	type: "text";
	text: string;
	cache_control?: unknown;
};

// ─── Adapter interface ─────────────────────────────────────────────
// Modeled on dsh's abstract class LlmAdapter: the only required method is
// stream().
// fusion-code uses direct construction (client.ts→seam.ts builds requests by
// APIProvider), no Cordis runtime registry introduced。
export interface LlmAdapter {
	// The only required method: stream a single model call as neutral chunks.
	// Implementations must honor options.signal.
	stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
	// Optional: provider display name
	providerInfo?(): { id: string; name: string };
	// Optional: list promotable models (advisory, no request validation)
	listModels?(): Promise<readonly { id: string; name: string }[]>;
	// Optional: resolve a single model's metadata (context window / default
	// max_tokens / reasoning)
	resolveModel?(
		model: string,
		signal?: AbortSignal,
	): Promise<{
		id: string;
		name: string;
		contextWindow?: number;
		defaultMaxTokens?: number;
	}>;
}
