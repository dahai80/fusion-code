// Anthropic Messages API protocol types (locally defined, decoupled from @anthropic-ai/sdk)
//
// All types are redeclared locally; neither runtime nor type layer depends on the SDK anymore.
// The Anthropic namespace owns the concrete definitions; top-level aliases re-export them for direct import.
// Shapes are faithful to the original SDK definitions (field names / optionality / literal unions / arrays);
// members not defined individually are closed out by open interfaces carrying common optional fields, preserving type discrimination.

// ─── Shared helper types ──────────────────────────────────────────

// Cache control breakpoint (ephemeral).
export interface CacheControlEphemeral {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

// Direct caller marker.
export interface DirectCaller {
	type: "direct";
}

// Server tool caller marker (shape-compatible, lenient fields).
export interface ServerToolCaller {
	type: string;
	[k: string]: unknown;
}
export interface ServerToolCaller20260120 {
	type: string;
	[k: string]: unknown;
}

// Source reference: base64 image.
export interface Base64ImageSource {
	data: string;
	media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	type: "base64";
}

// URL image source.
export interface URLImageSource {
	type: "url";
	url: string;
}

// Tool input JSON schema (Tool namespace member).
export interface ToolInputSchema {
	type: "object";
	properties?: unknown | null;
	required?: Array<string> | null;
	[k: string]: unknown;
}

// ─── Anthropic namespace (owns concrete definitions) ────────────────────
// In the SDK, Anthropic is both a client class and a namespace (nested Beta.Messages / Tool.InputSchema).
// Here a namespace owns all concrete definitions; top-level aliases re-export them for direct import by 100+ files.
// The client instance type has been replaced by LlmClient (src/services/llm/client.ts); this namespace only serves
// Anthropic.X dotted access after `import type { Anthropic }` plus top-level alias imports.

export namespace Anthropic {
	// ── 1. Message Block types (request params) ──────────────────

	export interface TextBlockParam {
		text: string;
		type: "text";
		cache_control?: CacheControlEphemeral | null;
		citations?: Array<Record<string, unknown>> | null;
	}

	export interface ImageBlockParam {
		source: Base64ImageSource | URLImageSource;
		type: "image";
		cache_control?: CacheControlEphemeral | null;
	}

	export interface ThinkingBlockParam {
		signature: string;
		thinking: string;
		type: "thinking";
	}

	export interface RedactedThinkingBlockParam {
		data: string;
		type: "redacted_thinking";
	}

	export interface ToolUseBlockParam {
		id: string;
		input: unknown;
		name: string;
		type: "tool_use";
		cache_control?: CacheControlEphemeral | null;
		caller?: DirectCaller | ServerToolCaller | ServerToolCaller20260120;
	}

	export interface ToolResultBlockParam {
		tool_use_id: string;
		type: "tool_result";
		cache_control?: CacheControlEphemeral | null;
		content?: string | Array<ToolResultContentBlockParam>;
		is_error?: boolean;
	}

	// Open request block: closing shape for members not defined individually (document/search/server tool etc.).
	// type uses the branded string `string & {}`: accepts any literal without breaking union discrimination.
	export interface RawBlockParam {
		type: string & {};
		[k: string]: unknown;
	}

	// Request-side document block (PDF and other file attachments).
	export interface DocumentBlockParam {
		type: "document";
		source:
			| { type: "base64"; media_type: string; data: string }
			| { type: "url"; url: string }
			| { type: "text"; media_type: "text/plain"; data: string }
			| { type: "file"; file_id: string }
			| { type: "content"; content: unknown };
		citations?: { enabled?: boolean } | null;
		context?: string | null;
		title?: string | null;
		cache_control?: CacheControlEphemeral | null;
	}

	// Extra request blocks nestable in tool_result.content (SDK: TextBlockParam | ImageBlockParam | SearchResultBlockParam | DocumentBlockParam | ToolReferenceBlockParam).
	export interface SearchResultBlockParam {
		content: Array<TextBlockParam>;
		source: string;
		title: string;
		type: "search_result";
		cache_control?: CacheControlEphemeral | null;
		citations?: Record<string, unknown> | null;
	}
	export interface ToolReferenceBlockParam {
		tool_name: string;
		type: "tool_reference";
		cache_control?: CacheControlEphemeral | null;
	}
	export type ToolResultContentBlockParam =
		| TextBlockParam
		| ImageBlockParam
		| SearchResultBlockParam
		| DocumentBlockParam
		| ToolReferenceBlockParam;

	// ContentBlockParam: full request block union (discriminable).
	// No catch-all: each member's type is a literal, guaranteeing narrowing via `find(_.type===...)?.x`.
	// RawBlockParam stays a standalone type for explicit reference but does not enter the discriminated union.
	export type ContentBlockParam =
		| TextBlockParam
		| ImageBlockParam
		| ThinkingBlockParam
		| RedactedThinkingBlockParam
		| ToolUseBlockParam
		| ToolResultBlockParam
		| DocumentBlockParam
		| ServerToolUseBlock
		| WebSearchToolResultBlock
		| SearchResultBlock
		| CodeExecutionToolResultBlock
		| MCPToolUseBlock
		| MCPToolResultBlock
		| ContainerUploadBlock
		| WebFetchToolResultBlock
		| BashCodeExecutionToolResultBlock
		| TextEditorCodeExecutionToolResultBlock
		| ToolSearchToolResultBlock
		| CompactionBlock
		| ToolResultBlock;

	// ── 2. Message Block types (response) ──────────────────────
	//
	// Key point: each member's type must be a literal for the union to form a
	// discriminated union, so that `arr.find(_ => _.type === "text")?.text`
	// narrows correctly (matching SDK behavior). The catch-all uses the
	// `type: string & {}` branded string to keep discrimination while accepting any unknown type.

	export interface TextBlock {
		citations: Array<Record<string, unknown>> | null;
		text: string;
		type: "text";
	}

	export interface ThinkingBlock {
		signature: string;
		thinking: string;
		type: "thinking";
	}

	export interface RedactedThinkingBlock {
		data: string;
		type: "redacted_thinking";
	}

	export interface ToolUseBlock {
		id: string;
		caller?: DirectCaller | ServerToolCaller | ServerToolCaller20260120;
		input: unknown;
		name: string;
		type: "tool_use";
	}

	// image response block (appears in assistant replay / historical messages).
	export interface ImageBlock {
		source: Base64ImageSource | URLImageSource;
		type: "image";
	}

	// Server tool use block (web_search etc.).
	export interface ServerToolUseBlock {
		id: string;
		input: unknown;
		name: string;
		type: "server_tool_use";
	}

	// web_search tool result block: content is an error object or a result array.
	export interface WebSearchToolResultBlock {
		tool_use_id: string;
		type: "web_search_tool_result";
		content:
			| { error_code?: string; [k: string]: unknown }
			| Array<{ title?: string; url?: string; [k: string]: unknown }>;
	}

	// tool_result response block (occasionally appears in assistant history). content is shape-identical to ToolResultBlockParam,
	// so response blocks can be fed back as request content (matching SDK behavior) while .text access stays correct after narrowing.
	export interface ToolResultBlock {
		tool_use_id: string;
		type: "tool_result";
		content?: string | Array<ToolResultContentBlockParam>;
		is_error?: boolean;
	}

	// Remaining server/builtin tool results and special blocks: the codebase discriminates them via switch cases,
	// mostly pass-through. A literal type suffices to make them discriminated-union members; fields optional as needed.
	export interface DocumentBlock {
		type: "document";
		source:
			| { type: "base64"; media_type: string; data: string }
			| { type: "url"; url: string }
			| { type: "text"; media_type: "text/plain"; data: string }
			| { type: "file"; file_id: string }
			| { type: "content"; content: unknown };
		citations?: { enabled?: boolean } | null;
		context?: string | null;
		title?: string | null;
		[k: string]: unknown;
	}
	export interface SearchResultBlock {
		type: "search_result";
		[k: string]: unknown;
	}
	export interface CodeExecutionToolResultBlock {
		type: "code_execution_tool_result";
		[k: string]: unknown;
	}
	export interface MCPToolUseBlock {
		type: "mcp_tool_use";
		id?: string;
		name?: string;
		input?: unknown;
		[k: string]: unknown;
	}
	export interface MCPToolResultBlock {
		type: "mcp_tool_result";
		tool_use_id?: string;
		content?: unknown;
		is_error?: boolean;
		[k: string]: unknown;
	}
	export interface ContainerUploadBlock {
		type: "container_upload";
		[k: string]: unknown;
	}
	export interface WebFetchToolResultBlock {
		type: "web_fetch_tool_result";
		[k: string]: unknown;
	}
	export interface BashCodeExecutionToolResultBlock {
		type: "bash_code_execution_tool_result";
		[k: string]: unknown;
	}
	export interface TextEditorCodeExecutionToolResultBlock {
		type: "text_editor_code_execution_tool_result";
		[k: string]: unknown;
	}
	export interface ToolSearchToolResultBlock {
		type: "tool_search_tool_result";
		[k: string]: unknown;
	}
	export interface CompactionBlock {
		type: "compaction";
		content?: string | null;
		[k: string]: unknown;
	}

	// Open response block: closing shape for server/builtin tool result blocks not defined individually.
	// type uses the branded string `string & {}`: accepts any literal without breaking union discrimination.
	export interface RawBlock {
		type: string & {};
		[k: string]: unknown;
	}

	// ContentBlock: response content block union (discriminable, no catch-all).
	export type ContentBlock =
		| TextBlock
		| ThinkingBlock
		| RedactedThinkingBlock
		| ToolUseBlock
		| ToolResultBlock
		| ImageBlock
		| ServerToolUseBlock
		| WebSearchToolResultBlock
		| DocumentBlock
		| SearchResultBlock
		| CodeExecutionToolResultBlock
		| MCPToolUseBlock
		| MCPToolResultBlock
		| ContainerUploadBlock
		| WebFetchToolResultBlock
		| BashCodeExecutionToolResultBlock
		| TextEditorCodeExecutionToolResultBlock
		| ToolSearchToolResultBlock
		| CompactionBlock;

	// ── 3. Tool-related types ────────────────────────────────────

	// Tool is both an interface (instance fields) and a namespace (InputSchema), expressed via declaration merging.
	export interface Tool {
		input_schema: ToolInputSchema;
		name: string;
		allowed_callers?: Array<
			"direct" | "code_execution_20250825" | "code_execution_20260120"
		>;
		cache_control?: CacheControlEphemeral | null;
		defer_loading?: boolean;
		description?: string;
		eager_input_streaming?: boolean | null;
		input_examples?: Array<{ [key: string]: unknown }>;
		strict?: boolean;
		type?: "custom" | null;
	}
	export namespace Tool {
		export type InputSchema = ToolInputSchema;
	}

	// Tool union: custom tool + various server/builtin tools, closed compatibly by RawTool.
	export interface RawTool {
		type: string;
		name?: string;
		input_schema?: ToolInputSchema;
		cache_control?: CacheControlEphemeral | null;
		description?: string;
	}
	export type ToolUnion = Tool | RawTool;

	export interface ToolChoiceAuto {
		type: "auto";
		disable_parallel_tool_use?: boolean;
	}
	export interface ToolChoiceAny {
		type: "any";
		disable_parallel_tool_use?: boolean;
	}
	export interface ToolChoiceNone {
		type: "none";
	}
	export interface ToolChoiceTool {
		name: string;
		type: "tool";
		disable_parallel_tool_use?: boolean;
	}
	export type ToolChoice =
		| ToolChoiceAuto
		| ToolChoiceAny
		| ToolChoiceTool
		| ToolChoiceNone;

	// ── 4. General types ────────────────────────────────────────

	export interface MessageParam {
		content: string | Array<ContentBlockParam>;
		role: "user" | "assistant";
	}

	export interface ThinkingConfigEnabled {
		budget_tokens: number;
		type: "enabled";
		display?: "summarized" | "omitted" | null;
	}
	export interface ThinkingConfigDisabled {
		type: "disabled";
	}
	export interface ThinkingConfigAdaptive {
		type: "adaptive";
		display?: "summarized" | "omitted" | null;
	}
	export type ThinkingConfigParam =
		| ThinkingConfigEnabled
		| ThinkingConfigDisabled
		| ThinkingConfigAdaptive;

	export interface Metadata {
		user_id?: string | null;
	}

	// Top-level request body (BetaMessageStreamParams = MessageCreateParamsBase).
	export interface MessageCreateParamsBase {
		max_tokens: number;
		messages: Array<MessageParam | BetaMessageParam>;
		model: string;
		cache_control?: CacheControlEphemeral | null;
		container?: string | null;
		context_management?: Record<string, unknown> | null;
		inference_geo?: string | null;
		metadata?: Metadata;
		output_config?: BetaOutputConfig | Record<string, unknown>;
		service_tier?: "auto" | "standard_only";
		speed?: "standard" | "fast";
		stop_sequences?: Array<string>;
		stream?: boolean;
		system?: string | Array<TextBlockParam>;
		temperature?: number;
		thinking?: ThinkingConfigParam;
		tool_choice?: ToolChoice;
		tools?: Array<ToolUnion>;
		top_k?: number;
		top_p?: number;
		betas?: Array<string>;
		[k: string]: unknown;
	}

	// ── 5. Beta Message types ───────────────────────────────

	export interface BetaThinkingConfigEnabled {
		budget_tokens: number;
		type: "enabled";
		display?: "summarized" | "omitted" | null;
	}
	export interface BetaThinkingConfigDisabled {
		type: "disabled";
	}
	export interface BetaThinkingConfigAdaptive {
		type: "adaptive";
		display?: "summarized" | "omitted" | null;
	}
	export type BetaThinkingConfigParam =
		| BetaThinkingConfigEnabled
		| BetaThinkingConfigDisabled
		| BetaThinkingConfigAdaptive;

	export interface BetaImageBlockParam {
		source:
			| Base64ImageSource
			| URLImageSource
			| { file_id: string; type: "file" };
		type: "image";
		cache_control?: CacheControlEphemeral | null;
	}

	export interface BetaThinkingBlockParam {
		signature: string;
		thinking: string;
		type: "thinking";
	}

	export interface BetaThinkingBlock {
		signature: string;
		thinking: string;
		type: "thinking";
	}

	export interface BetaRedactedThinkingBlock {
		data: string;
		type: "redacted_thinking";
	}

	export interface BetaRedactedThinkingBlockParam {
		data: string;
		type: "redacted_thinking";
	}

	export interface BetaRequestDocumentBlock {
		source: Record<string, unknown>;
		type: "document";
		cache_control?: CacheControlEphemeral | null;
		citations?: { enabled?: boolean } | null;
		context?: string | null;
		title?: string | null;
	}

	export interface BetaToolUseBlock {
		id: string;
		input: unknown;
		name: string;
		type: "tool_use";
		caller?: DirectCaller | ServerToolCaller | ServerToolCaller20260120;
	}

	export type BetaToolUseBlockParam = ToolUseBlockParam;

	export interface BetaToolResultBlockParam {
		tool_use_id: string;
		type: "tool_result";
		cache_control?: CacheControlEphemeral | null;
		content?: string | Array<ToolResultContentBlockParam | BetaImageBlockParam>;
		is_error?: boolean;
	}

	export interface BetaTool {
		input_schema: ToolInputSchema;
		name: string;
		allowed_callers?: Array<
			"direct" | "code_execution_20250825" | "code_execution_20260120"
		>;
		cache_control?: CacheControlEphemeral | null;
		defer_loading?: boolean;
		description?: string;
		eager_input_streaming?: boolean | null;
		input_examples?: Array<{ [key: string]: unknown }>;
		strict?: boolean;
		type?: "custom" | null;
	}

	export interface BetaRawTool {
		type: string;
		name?: string;
		input_schema?: ToolInputSchema;
		cache_control?: CacheControlEphemeral | null;
		description?: string;
	}
	export type BetaToolUnion =
		| BetaTool
		| BetaRawTool
		| BetaWebSearchTool20250305;

	export interface BetaToolChoiceAuto {
		type: "auto";
		disable_parallel_tool_use?: boolean;
	}
	export interface BetaToolChoiceTool {
		name: string;
		type: "tool";
		disable_parallel_tool_use?: boolean;
	}

	export interface BetaWebSearchTool20250305 {
		name: "web_search";
		type: "web_search_20250305";
		allowed_callers?: Array<
			"direct" | "code_execution_20250825" | "code_execution_20260120"
		>;
		allowed_domains?: Array<string> | null;
		blocked_domains?: Array<string> | null;
		cache_control?: CacheControlEphemeral | null;
		defer_loading?: boolean;
		max_uses?: number | null;
		strict?: boolean;
		user_location?: Record<string, unknown> | null;
	}

	export interface BetaJSONOutputFormat {
		schema: { [key: string]: unknown };
		type: "json_schema";
	}

	export interface BetaOutputConfig {
		effort?: "low" | "medium" | "high" | "max" | null;
		format?: BetaJSONOutputFormat | null;
	}

	export type BetaIterationsUsage = Array<Record<string, unknown>>;

	export interface BetaUsage {
		cache_creation: {
			ephemeral_1h_input_tokens: number;
			ephemeral_5m_input_tokens: number;
			[k: string]: unknown;
		} | null;
		cache_creation_input_tokens: number | null;
		cache_read_input_tokens: number | null;
		inference_geo: string | null;
		input_tokens: number;
		iterations: BetaIterationsUsage | null;
		output_tokens: number;
		server_tool_use: {
			web_search_requests: number;
			web_fetch_requests: number;
			[k: string]: unknown;
		} | null;
		service_tier: "standard" | "priority" | "batch" | null;
		speed: "standard" | "fast" | null;
	}

	export interface BetaMessageDeltaUsage {
		cache_creation_input_tokens: number | null;
		cache_read_input_tokens: number | null;
		input_tokens: number | null;
		iterations: BetaIterationsUsage | null;
		output_tokens: number;
		server_tool_use: {
			web_search_requests: number;
			web_fetch_requests: number;
			[k: string]: unknown;
		} | null;
		speed?: "standard" | "fast" | null;
		service_tier?: "standard" | "priority" | "batch" | null;
	}

	// BetaContentBlockParam: Beta request block union.
	export type BetaContentBlockParam =
		| TextBlockParam
		| BetaImageBlockParam
		| BetaRequestDocumentBlock
		| BetaThinkingBlockParam
		| BetaRedactedThinkingBlockParam
		| BetaToolUseBlockParam
		| BetaToolResultBlockParam
		| ServerToolUseBlock
		| WebSearchToolResultBlock
		| SearchResultBlock
		| CodeExecutionToolResultBlock
		| MCPToolUseBlock
		| MCPToolResultBlock
		| ContainerUploadBlock
		| WebFetchToolResultBlock
		| BashCodeExecutionToolResultBlock
		| TextEditorCodeExecutionToolResultBlock
		| ToolSearchToolResultBlock
		| CompactionBlock
		| ToolResultBlock
		| TextBlock
		| ThinkingBlock
		| RedactedThinkingBlock
		| ToolUseBlock
		| ImageBlock
		| DocumentBlock;

	export interface BetaMessageParam {
		content: string | Array<BetaContentBlockParam>;
		role: "user" | "assistant";
	}

	// BetaContentBlock: Beta response block union (discriminable, no catch-all).
	export type BetaContentBlock =
		| BetaThinkingBlock
		| BetaRedactedThinkingBlock
		| BetaToolUseBlock
		| TextBlock
		| ToolResultBlock
		| ImageBlock
		| ServerToolUseBlock
		| WebSearchToolResultBlock
		| DocumentBlock
		| SearchResultBlock
		| CodeExecutionToolResultBlock
		| MCPToolUseBlock
		| MCPToolResultBlock
		| ContainerUploadBlock
		| WebFetchToolResultBlock
		| BashCodeExecutionToolResultBlock
		| TextEditorCodeExecutionToolResultBlock
		| ToolSearchToolResultBlock
		| CompactionBlock;

	export type BetaStopReason =
		| "end_turn"
		| "max_tokens"
		| "stop_sequence"
		| "tool_use"
		| "pause_turn"
		| "compaction"
		| "refusal"
		| "model_context_window_exceeded";

	export interface BetaMessage {
		id: string;
		container: Record<string, unknown> | null;
		content: Array<BetaContentBlock>;
		context_management: Record<string, unknown> | null;
		model: string;
		role: "assistant";
		stop_reason: BetaStopReason | null;
		stop_sequence: string | null;
		type: "message";
		usage: BetaUsage;
	}

	export type BetaMessageStreamParams = MessageCreateParamsBase;

	// ── 6. Streaming types ────────────────────────────────────────

	export interface BetaRawMessageStartEvent {
		message: BetaMessage;
		type: "message_start";
	}
	export interface BetaRawMessageDeltaEvent {
		context_management: Record<string, unknown> | null;
		delta: {
			container: Record<string, unknown> | null;
			stop_reason: BetaStopReason | null;
			stop_sequence: string | null;
		};
		type: "message_delta";
		usage: BetaMessageDeltaUsage;
	}
	export interface BetaRawMessageStopEvent {
		type: "message_stop";
	}
	export interface BetaRawContentBlockStartEvent {
		content_block: BetaContentBlock;
		index: number;
		type: "content_block_start";
	}
	// delta union of content_block_delta (claude.ts switch narrows by delta.type and reads fields).
	export interface BetaTextDelta {
		text: string;
		type: "text_delta";
	}
	export interface BetaInputJSONDelta {
		partial_json: string;
		type: "input_json_delta";
	}
	export interface BetaThinkingDelta {
		thinking: string;
		type: "thinking_delta";
	}
	export interface BetaSignatureDelta {
		signature: string;
		type: "signature_delta";
	}
	export interface BetaCitationsDelta {
		citation: Record<string, unknown>;
		type: "citations_delta";
	}
	export interface BetaRawContentBlockDeltaEvent {
		delta:
			| BetaTextDelta
			| BetaInputJSONDelta
			| BetaThinkingDelta
			| BetaSignatureDelta
			| BetaCitationsDelta
			| ({ type: "connector_text_delta"; connector_text: string } & Record<
					string,
					unknown
			  >);
		index: number;
		type: "content_block_delta";
	}
	export interface BetaRawContentBlockStopEvent {
		index: number;
		type: "content_block_stop";
	}
	export type BetaRawMessageStreamEvent =
		| BetaRawMessageStartEvent
		| BetaRawMessageDeltaEvent
		| BetaRawMessageStopEvent
		| BetaRawContentBlockStartEvent
		| BetaRawContentBlockDeltaEvent
		| BetaRawContentBlockStopEvent;

	// Stream<T>: minimal shape of the SDK stream — async iterable + controller (claude.ts uses stream.controller.abort()).
	export interface Stream<T> extends AsyncIterable<T> {
		controller: AbortController;
		[Symbol.asyncIterator](): AsyncIterator<T>;
		tee?(): [Stream<T>, Stream<T>];
		toReadableStream?(): ReadableStream<unknown>;
	}

	// ── 7. Client types ──────────────────────────────────────

	export type SdkFetch = (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>;

	export type SdkLogLevel = "off" | "error" | "warn" | "info" | "debug";
	export interface SdkLogger {
		error: (message: string, ...rest: unknown[]) => void;
		warn: (message: string, ...rest: unknown[]) => void;
		info: (message: string, ...rest: unknown[]) => void;
		debug: (message: string, ...rest: unknown[]) => void;
	}

	export interface ClientOptions {
		apiKey?: string | (() => Promise<string>) | null;
		authToken?: string | null;
		baseURL?: string | null;
		timeout?: number;
		fetchOptions?: Record<string, unknown>;
		fetch?: SdkFetch | null;
		maxRetries?: number;
		defaultHeaders?: Headers | Record<string, string> | null;
		defaultQuery?: Record<string, string | undefined>;
		dangerouslyAllowBrowser?: boolean;
		logLevel?: SdkLogLevel;
		logger?: SdkLogger;
	}

	// ── 8. Error types ──────────────────────────────────────
	// APIError shape (used by the duck-typing bridge isApiErrorLike / errors.ts).
	export interface APIError extends Error {
		status?: number;
		headers?:
			| Headers
			| Record<string, string>
			| { get?(name: string): string | null };
		error?: { message?: string; type?: string; [k: string]: unknown };
		requestID?: string | null;
	}

	// ── Nested namespaces ───────────────────────────────────────
	export namespace Beta {
		export namespace Messages {
			export type BetaMessageParam = Anthropic.BetaMessageParam;
			export type BetaToolUnion = Anthropic.BetaToolUnion;
			export type BetaMessage = Anthropic.BetaMessage;
			export type BetaToolUseBlockParam = Anthropic.BetaToolUseBlockParam;
			export type BetaToolResultBlockParam = Anthropic.BetaToolResultBlockParam;
			export type BetaThinkingConfigParam = Anthropic.BetaThinkingConfigParam;
			export type BetaJSONOutputFormat = Anthropic.BetaJSONOutputFormat;
		}
	}
}

// ─── Top-level alias re-exports (for direct `import type { X }`) ─────
// Point to Anthropic namespace members; one-way references, no cycles.

export type TextBlockParam = Anthropic.TextBlockParam;
export type ImageBlockParam = Anthropic.ImageBlockParam;
export type ThinkingBlockParam = Anthropic.ThinkingBlockParam;
export type RedactedThinkingBlockParam = Anthropic.RedactedThinkingBlockParam;
export type ToolUseBlockParam = Anthropic.ToolUseBlockParam;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;
export type ContentBlockParam = Anthropic.ContentBlockParam;
export type TextBlock = Anthropic.TextBlock;
export type ThinkingBlock = Anthropic.ThinkingBlock;
export type RedactedThinkingBlock = Anthropic.RedactedThinkingBlock;
export type ToolUseBlock = Anthropic.ToolUseBlock;
export type ContentBlock = Anthropic.ContentBlock;
export type Tool = Anthropic.Tool;
export type ToolUnion = Anthropic.ToolUnion;
export type ToolChoice = Anthropic.ToolChoice;
export type MessageParam = Anthropic.MessageParam;
export type BetaContentBlock = Anthropic.BetaContentBlock;
export type BetaContentBlockParam = Anthropic.BetaContentBlockParam;
export type BetaImageBlockParam = Anthropic.BetaImageBlockParam;
export type BetaThinkingBlock = Anthropic.BetaThinkingBlock;
export type BetaThinkingBlockParam = Anthropic.BetaThinkingBlockParam;
export type BetaRedactedThinkingBlock = Anthropic.BetaRedactedThinkingBlock;
export type BetaRedactedThinkingBlockParam =
	Anthropic.BetaRedactedThinkingBlockParam;
export type BetaRequestDocumentBlock = Anthropic.BetaRequestDocumentBlock;
export type BetaToolUseBlock = Anthropic.BetaToolUseBlock;
export type BetaToolUseBlockParam = Anthropic.BetaToolUseBlockParam;
export type BetaTool = Anthropic.BetaTool;
export type BetaToolUnion = Anthropic.BetaToolUnion;
export type BetaToolResultBlockParam = Anthropic.BetaToolResultBlockParam;
export type BetaToolChoiceAuto = Anthropic.BetaToolChoiceAuto;
export type BetaToolChoiceTool = Anthropic.BetaToolChoiceTool;
export type BetaWebSearchTool20250305 = Anthropic.BetaWebSearchTool20250305;
export type BetaUsage = Anthropic.BetaUsage;
export type BetaMessageDeltaUsage = Anthropic.BetaMessageDeltaUsage;
export type BetaJSONOutputFormat = Anthropic.BetaJSONOutputFormat;
export type BetaOutputConfig = Anthropic.BetaOutputConfig;
export type BetaRawMessageStreamEvent = Anthropic.BetaRawMessageStreamEvent;
export type BetaMessageParam = Anthropic.BetaMessageParam;
export type BetaMessageStreamParams = Anthropic.BetaMessageStreamParams;
export type BetaMessage = Anthropic.BetaMessage;
export type BetaStopReason = Anthropic.BetaStopReason;
export type Stream<T> = Anthropic.Stream<T>;
export type APIError = Anthropic.APIError;
export type SdkFetch = Anthropic.SdkFetch;
export type ClientOptions = Anthropic.ClientOptions;
export type ToolInputSchemaLocal = ToolInputSchema;

// AnthropicDefault: default-export alias reusing the Anthropic namespace (value + types).
// Legacy code used `import { default as AnthropicDefault }` to get the client instance type and access it dot-style;
// after SDK removal the client instance type is replaced by LlmClient, while namespace member access still goes through Anthropic.
// `export =`-style semantics are expressed so that `import { AnthropicDefault }` works as both namespace and type.
export { Anthropic as default, Anthropic as AnthropicDefault };
