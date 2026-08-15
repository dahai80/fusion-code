// LLM 接缝 — provider 中立类型 (参考 deepseek-harness LlmAdapter)
//
// 这是 fusion-code 去 Anthropic SDK 的核心抽象层。所有 provider (fusion-mlx / firstParty /
// openai / foundry / bedrock / vertex) 经各自的 LlmAdapter 把线上消息翻译成下面的中立 chunk。
// 主调用循环 (src/services/api/claude.ts) 消费 AsyncIterable<StreamChunk>, 不再 instanceof SDK 类型。
//
// 设计依据: claude.ts 现有 switch(part.type) 消费 Anthropic SSE 事件, 本类型与之逐一映射。

// ─── 内容块类型 ─────────────────────────────────────────────
// 中立内容块标签, 与 Anthropic content_block.type 对齐, 便于适配器零损耗映射。
export type ContentBlockType =
	| "text"
	| "thinking"
	| "tool_use"
	| "server_tool_use"
	| "tool_result"
	| "connector_text";

// ─── token 计费 ─────────────────────────────────────────────
// cache 字段可选: 仅 provider 上报非零时出现 (参考 dsh TokenUsage)。
export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
}

// ─── 流式 chunk ─────────────────────────────────────────────
// 适配器把一次模型调用流式吐成下列 chunk。block index 关联同一块的交错 delta。
// 与 claude.ts 现有 Anthropic SSE 事件 switch 分支逐一对应:
//   message-start      ← message_start (携带初始 usage / ttft)
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

// block-start 携带的原始内容块 (展开字段, 非 SDK 类型)。
// 适配器从 provider wire 原样搬运, 主循环按 type 分派累积。
export interface RawContentBlock {
	type: ContentBlockType;
	// text/thinking 块
	text?: string;
	thinking?: string;
	signature?: string;
	// tool_use / server_tool_use 块
	id?: string;
	name?: string;
	input?: string | Record<string, unknown>;
	// tool_result 块
	toolUseId?: string;
	content?: unknown;
	isError?: boolean;
	// 透传未识别字段 (advisor_tool_result 等 server 扩展)
	[extra: string]: unknown;
}

// ─── 结束原因 ───────────────────────────────────────────────
// 参考 dsh FinishReasonMap: 稳定中立码, 非 SDK 的 stop_reason 字符串。
export type FinishReason =
	| "end_turn"
	| "tool_use"
	| "max_tokens"
	| "stop_sequence"
	| "aborted"
	| "error";

// ─── 失败 ───────────────────────────────────────────────────
// provider 中立失败事实 (参考 dsh LlmFailure)。替代 instanceof APIError 判定。
// code 是稳定机器路由码; withRetry/errors 据此判重试/分类。
export type LlmErrorCode =
	| "AUTH"
	| "RATE_LIMIT"
	| "INVALID_REQUEST"
	| "SERVER"
	| "TIMEOUT"
	| "TRANSPORT"
	| "ABORTED";

export interface LlmFailure {
	code: LlmErrorCode;
	message: string;
	status?: number;
	providerRetryAfterMs?: number;
	requestId?: string;
}

// ─── 工具 schema ────────────────────────────────────────────
// 送往模型的工具描述 (JSON Schema 参数)。与 dsh ToolSchema 对齐。
export interface ToolSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

// ─── 请求选项 ───────────────────────────────────────────────
// 一次完整组装的模型请求 (参考 dsh GenerateOptions)。
// messages 是中立结构 (与 Anthropic MessageParam 形状一致: role + content)。
// 适配器负责映射到 provider wire 格式。
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
	// 请求来源标记, 透传到适配器做路由/日志 (如 compaction / session-title 辅助调用)。
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

// ─── 适配器接口 ─────────────────────────────────────────────
// 参考 dsh abstract class LlmAdapter: 唯一必需方法 stream()。
// fusion-code 用静态分派 (registry.ts 按 APIProvider 返回实例), 不引入 Cordis 运行时注册。
export interface LlmAdapter {
	// 唯一必需方法: 把一次模型调用流式吐成中立 chunk。实现须遵守 options.signal。
	stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
	// 可选: provider 显示名
	providerInfo?(): { id: string; name: string };
	// 可选: 列出可宣传的模型 (advisory, 不做请求校验)
	listModels?(): Promise<readonly { id: string; name: string }[]>;
	// 可选: 解析单个模型元数据 (context window / 默认 max_tokens / reasoning)
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
