/**
 * Fusion-MLX API 类型定义
 *
 * 定义 fusion-mlx 本地推理引擎的 HTTP API 类型。
 * fusion-mlx 兼容 OpenAI /v1/chat/completions 格式，
 * 同时扩展了 Anthropic Messages API 格式支持。
 */

// ─── OpenAI-compatible Chat Completions ───────────────────────

export interface MLXChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | MLXContentPart[]
  name?: string
  tool_call_id?: string
}

export type MLXContentPart =
  | MLXTextContent
  | MLXImageContent
  | MLXToolCallContent

export interface MLXTextContent {
  type: 'text'
  text: string
}

export interface MLXImageContent {
  type: 'image_url'
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' }
}

export interface MLXToolCallContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface MLXToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface MLXChatCompletionRequest {
  model: string
  messages: MLXChatMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  repetition_penalty?: number
  frequency_penalty?: number
  presence_penalty?: number
  stream?: boolean
  tools?: MLXToolDefinition[]
  tool_choice?: 'auto' | 'any' | 'none' | { type: 'function'; function: { name: string } }
  stop?: string | string[]
  /** 启用推理/思考过程（Qwen3 等模型支持），27B+ 模型自动启用 */
  enable_thinking?: boolean
  /**
   * 结构化输出约束（JSON Schema）
   * 用于强制模型输出符合指定 Schema 的 JSON，
   * 替代脆弱的 prompt 约束 + 正则解析。
   * 对应 OpenAI response_format 参数。
   */
  response_format?: {
    type: 'json_object' | 'json_schema'
    json_schema?: {
      name: string
      description?: string
      schema: Record<string, unknown>
      strict?: boolean
    }
  }
}

export interface MLXChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: MLXChatChoice[]
  usage: MLXUsage
}

export interface MLXChatChoice {
  index: number
  message: MLXResponseMessage
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export interface MLXResponseMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: MLXResponseToolCall[]
}

export interface MLXResponseToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface MLXUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// ─── SSE Stream Events ────────────────────────────────────────

export type MLXStreamChunk =
  | MLXStreamChunkChoice
  | MLXStreamDone

export interface MLXStreamChunkChoice {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: MLXStreamDelta
    finish_reason: 'stop' | 'length' | 'tool_calls' | null
  }>
}

export interface MLXStreamDelta {
  role?: 'assistant'
  content?: string
  reasoning_content?: string
  tool_calls?: Array<{
    index: number
    id: string
    type: 'function'
    function: { name?: string; arguments: string }
  }>
}

export interface MLXStreamDone {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: MLXResponseMessage
    finish_reason: 'stop' | 'length' | 'tool_calls' | null
  }>
  usage: MLXUsage
}

// ─── Model List ───────────────────────────────────────────────

export interface MLXModelListResponse {
  object: 'list'
  data: MLXModelInfo[]
}

export interface MLXModelInfo {
  id: string
  object: 'model'
  created: number
  owned_by: string
  max_input_tokens?: number
  max_output_tokens?: number
}

// ─── Health Check ─────────────────────────────────────────────

// fusion-mlx#564 (PR #581): GET /v1/health 只读内存/OOM 端点。
// status 扩 degraded|oom; memory + oom_risk 为 #564 新增, 旧 MLX 无该端点时
// fetchMlxHealth 返 null (fail-open) 故此处全 optional 以兼容。
export interface MLXMemoryStat {
  name: string
  bytes: number
}

export interface MLXHealthMemory {
  rss_bytes: number
  used_bytes: number
  free_bytes: number
  total_bytes: number
  mlx_active_bytes: number | null
  mlx_cache_bytes: number | null
  mlx_peak_bytes: number | null
  per_model: MLXMemoryStat[]
}

export interface MLXHealthResponse {
  status: 'ok' | 'degraded' | 'oom' | 'error'
  version: string
  uptime_seconds: number
  active_models: string[]
  memory?: MLXHealthMemory
  oom_risk?: 'none' | 'low' | 'high' | 'imminent'
}

// ─── Anthropic-compatible Messages API ─────────────────────────

export interface MLXAnthropicMessageRequest {
  model: string
  messages: MLXAnthropicMessage[]
  system?: string | MLXAnthropicTextBlock[]
  max_tokens: number
  stream?: boolean
  temperature?: number
  top_p?: number
  tools?: MLXAnthropicTool[]
  tool_choice?: {
    type: 'auto' | 'any' | 'tool'
    name?: string
  }
}

export interface MLXAnthropicMessage {
  role: 'user' | 'assistant'
  content: string | MLXAnthropicContentBlock[]
}

export type MLXAnthropicContentBlock =
  | MLXAnthropicTextBlock
  | MLXAnthropicImageBlock
  | MLXAnthropicToolUseBlock
  | MLXAnthropicToolResultBlock

export interface MLXAnthropicTextBlock {
  type: 'text'
  text: string
}

export interface MLXAnthropicImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export interface MLXAnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface MLXAnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | MLXAnthropicTextBlock[]
  is_error?: boolean
}

export interface MLXAnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface MLXAnthropicMessageResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: MLXAnthropicResponseContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null
  stop_sequence: string | null
  usage: MLXAnthropicUsage
}

export type MLXAnthropicResponseContentBlock =
  | MLXAnthropicResponseTextBlock
  | MLXAnthropicResponseToolUseBlock

export interface MLXAnthropicResponseTextBlock {
  type: 'text'
  text: string
}

export interface MLXAnthropicResponseToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface MLXAnthropicUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// ─── Embeddings (for RAG / KB) ────────────────────────────────

export interface MLXEmbeddingRequest {
  model: string
  input: string | string[]
}

export interface MLXEmbeddingResponse {
  object: 'list'
  data: Array<{
    object: 'embedding'
    index: number
    embedding: number[]
  }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
}