// Anthropic Messages API 协议类型（本地定义，脱离 @anthropic-ai/sdk）
//
// 全部类型在本地重新声明，运行时与类型层均不再依赖 SDK。
// Anthropic 命名空间拥有具体定义，顶层再以别名 re-export 供直接导入。
// 形态忠实于 SDK 原定义（字段名 / 可选性 / 字面量联合 / 数组），
// 未单独定义的成员以携带公共可选字段的开放接口收尾，保留 type 判别。

// ─── 公共辅助类型 ──────────────────────────────────────────

// 缓存控制断点（ephemeral）。
export interface CacheControlEphemeral {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

// 直接调用方标记。
export interface DirectCaller {
	type: "direct";
}

// 服务端工具调用方标记（形态兼容，字段宽松）。
export interface ServerToolCaller {
	type: string;
	[k: string]: unknown;
}
export interface ServerToolCaller20260120 {
	type: string;
	[k: string]: unknown;
}

// 引用来源：base64 图像。
export interface Base64ImageSource {
	data: string;
	media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	type: "base64";
}

// URL 图像来源。
export interface URLImageSource {
	type: "url";
	url: string;
}

// 工具输入 JSON schema（Tool 命名空间成员）。
export interface ToolInputSchema {
	type: "object";
	properties?: unknown | null;
	required?: Array<string> | null;
	[k: string]: unknown;
}

// ─── Anthropic 命名空间（拥有具体定义） ────────────────────
// SDK 中 Anthropic 既是客户端类也是命名空间（嵌套 Beta.Messages / Tool.InputSchema）。
// 此处用 namespace 拥有所有具体定义，顶层再以别名 re-export 供 100+ 文件直接导入。
// 客户端实例类型已由 LlmClient（src/services/llm/client.ts）取代；本命名空间仅满足
// import type { Anthropic } 后的 Anthropic.X 点式访问 + 顶层别名导入。

export namespace Anthropic {
	// ── 1. Message Block 类型（请求参数） ──────────────────

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

	// 开放请求块：未单独定义的成员（document/search/server tool 等）的收尾形态。
	// type 用品牌字符串 `string & {}`：既接受任意字面量，又不破坏联合判别。
	export interface RawBlockParam {
		type: string & {};
		[k: string]: unknown;
	}

	// 请求侧 document 块（PDF 等文件附件）。
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

	// tool_result.content 中可嵌套的额外请求块 (SDK: TextBlockParam | ImageBlockParam | SearchResultBlockParam | DocumentBlockParam | ToolReferenceBlockParam)。
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

	// ContentBlockParam: 完整请求块联合（可判别）。
	// 不含 catch-all：每个成员 type 为字面量，保证 `find(_.type===...)?.x` 收窄。
	// RawBlockParam 保留为独立类型供显式引用，但不进入判别联合。
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

	// ── 2. Message Block 类型（响应） ──────────────────────
	//
	// 关键：每个成员的 type 必须是字面量，联合才构成可判别联合
	// (discriminated union)，使 `arr.find(_ => _.type === "text")?.text`
	// 能正确收窄（与 SDK 行为一致）。catch-all 用 `type: string & {}`
	// 品牌字符串保留判别能力，同时接受任意未知 type。

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

	// image 响应块（出现在 assistant 回放 / 历史消息中）。
	export interface ImageBlock {
		source: Base64ImageSource | URLImageSource;
		type: "image";
	}

	// 服务端工具调用块（web_search 等）。
	export interface ServerToolUseBlock {
		id: string;
		input: unknown;
		name: string;
		type: "server_tool_use";
	}

	// web_search 工具结果块：content 为错误对象或结果数组。
	export interface WebSearchToolResultBlock {
		tool_use_id: string;
		type: "web_search_tool_result";
		content:
			| { error_code?: string; [k: string]: unknown }
			| Array<{ title?: string; url?: string; [k: string]: unknown }>;
	}

	// tool_result 响应块（assistant 历史中偶现）。content 与 ToolResultBlockParam 同构,
	// 使响应块可回填为请求 content (与 SDK 行为一致), 收窄后 .text 访问仍正确。
	export interface ToolResultBlock {
		tool_use_id: string;
		type: "tool_result";
		content?: string | Array<ToolResultContentBlockParam>;
		is_error?: boolean;
	}

	// 其余服务端/内置工具结果与特殊块：代码库以 switch case 枚举判别，
	// 多为 pass-through。给出字面量 type 即可构成判别联合成员；按需字段可选。
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

	// 开放响应块：未单独定义的服务端/内置工具结果块等的收尾形态。
	// type 用品牌字符串 `string & {}`：既接受任意字面量，又不破坏联合判别。
	export interface RawBlock {
		type: string & {};
		[k: string]: unknown;
	}

	// ContentBlock: 响应内容块联合（可判别，不含 catch-all）。
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

	// ── 3. 工具相关类型 ────────────────────────────────────

	// Tool 既是接口（实例字段）也是命名空间（InputSchema），用声明合并表达。
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

	// 工具联合：custom tool + 各类服务端/内置工具，以 RawTool 收尾兼容。
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

	// ── 4. 通用类型 ────────────────────────────────────────

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

	// 顶层请求体（BetaMessageStreamParams = MessageCreateParamsBase）。
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

	// ── 5. Beta Message 类型 ───────────────────────────────

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

	// BetaContentBlockParam: Beta 请求块联合。
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

	// BetaContentBlock: Beta 响应块联合（可判别，不含 catch-all）。
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

	// ── 6. 流式类型 ────────────────────────────────────────

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
	// content_block_delta 的 delta 联合 (claude.ts switch 按 delta.type 收窄并读字段)。
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

	// Stream<T>: SDK 流的最小形态 — 异步可迭代 + controller（claude.ts 用 stream.controller.abort()）。
	export interface Stream<T> extends AsyncIterable<T> {
		controller: AbortController;
		[Symbol.asyncIterator](): AsyncIterator<T>;
		tee?(): [Stream<T>, Stream<T>];
		toReadableStream?(): ReadableStream<unknown>;
	}

	// ── 7. 客户端类型 ──────────────────────────────────────

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

	// ── 8. Error 类型 ──────────────────────────────────────
	// APIError 形态化（供 duck-typing 桥 isApiErrorLike / errors.ts 使用）。
	export interface APIError extends Error {
		status?: number;
		headers?:
			| Headers
			| Record<string, string>
			| { get?(name: string): string | null };
		error?: { message?: string; type?: string; [k: string]: unknown };
		requestID?: string | null;
	}

	// ── 嵌套命名空间 ───────────────────────────────────────
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

// ─── 顶层别名 re-export（供直接 import type { X } 使用） ─────
// 指向 Anthropic 命名空间成员，单向引用，无循环。

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

// AnthropicDefault：默认导出别名，复用 Anthropic 命名空间（值+类型）。
// 旧代码以 import { default as AnthropicDefault } 引入客户端实例类型并做点式访问；
// SDK 移除后客户端实例类型由 LlmClient 取代，命名空间成员访问仍走 Anthropic。
// 用 export = 表达"既是值又是类型"，让 import { AnthropicDefault } 可同时作命名空间与类型。
export { Anthropic as default, Anthropic as AnthropicDefault };
