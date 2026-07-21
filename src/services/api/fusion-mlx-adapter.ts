/**
 * Fusion-MLX 适配器
 *
 * 将 fusion-code 的 AI 调用从 Anthropic SDK 切换到 fusion-mlx 本地推理引擎。
 * 为上层代码提供兼容 Anthropic Messages API 的接口。
 *
 * fusion-mlx 运行在本地 127.0.0.1:11434，兼容 OpenAI /v1/chat/completions 格式。
 * 本适配器在内部做格式转换，外部保持与现有代码兼容。
 */

import { randomUUID } from 'crypto'

import { cleanToolList, validateToolCall } from './fusion-mlx-tool-validator.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import type {
  MLXChatCompletionRequest,
  MLXChatCompletionResponse,
  MLXChatMessage,
  MLXToolDefinition,
  MLXHealthResponse,
  MLXModelListResponse,
  MLXModelInfo,
  MLXEmbeddingRequest,
  MLXEmbeddingResponse,
} from './fusion-mlx-types.js'
import {
  transformMLXStreamToAnthropic,
  transformMLXResponseToAnthropic,
  type AnthropicStreamEvent,
  type AnthropicNonStreamingResponse,
} from './fusion-mlx-stream.js'

// ─── Configuration ────────────────────────────────────────────

const DEFAULT_MLX_BASE_URL = 'http://127.0.0.1:11434'

function getMlxBaseUrl(): string {
  return (
    process.env.FUSION_MLX_BASE_URL ||
    process.env.MLX_BASE_URL ||
    DEFAULT_MLX_BASE_URL
  )
}

function getMlxApiUrl(path: string): string {
  const base = getMlxBaseUrl().replace(/\/+$/, '')
  return `${base}${path}`
}

// ─── Health Check ─────────────────────────────────────────────

export interface FusionMlxStatus {
  available: boolean
  version?: string
  models: string[]
  uptime_seconds?: number
}

/**
 * 检测 fusion-mlx 服务是否可用。
 * 通过调用 /v1/models 端点检测（兼容不支持 /v1/health 的 MLX 服务）。
 */
export async function checkFusionMlxHealth(): Promise<FusionMlxStatus> {
  try {
    const response = await fetch(getMlxApiUrl('/v1/models'), {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return { available: false, models: [] }
    }

    const data = (await response.json()) as MLXModelListResponse
    const models = data.data?.map(m => m.id) || []
    return {
      available: true,
      version: 'unknown',
      models,
      uptime_seconds: 0,
    }
  } catch (error) {
    logForDebugging(
      `[Fusion-MLX] Health check failed: ${(error as Error).message}`,
    )
    return { available: false, models: [] }
  }
}

/**
 * 获取 fusion-mlx 上可用的模型列表。
 */
export async function getFusionMlxModels(): Promise<MLXModelInfo[]> {
  try {
    const response = await fetch(getMlxApiUrl('/v1/models'), {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as MLXModelListResponse
    return data.data || []
  } catch (error) {
    logForDebugging(
      `[Fusion-MLX] Model list fetch failed: ${(error as Error).message}`,
    )
    return []
  }
}

/**
 * 获取推荐用于代码任务的模型 ID。
 * 优先选择代码专用模型，回退到通用模型。
 */
export async function getRecommendedCodeModel(): Promise<string | null> {
  const models = await getFusionMlxModels()
  if (models.length === 0) return null

  // 排除图片/视频生成模型（不能用于聊天）
  const excludeKeywords = ['flux', 'skyreels', 'image', 'video', 'ltx', 'a2v', 'v2v', 'r2v', 'klein', 'txt2vid', 'img2vid', 'tts', 'whisper', 'embed', 'bge']
  const chatModels = models.filter(m => !excludeKeywords.some(k => m.id.toLowerCase().includes(k)))

  if (chatModels.length === 0) return models[0].id

  // 优先选择代码专用模型
  const codeModelKeywords = ['code', 'coder', 'deepseek', 'qwen', 'codestral', 'llama', 'mistral', 'instruct', 'chat']
  for (const keyword of codeModelKeywords) {
    const found = chatModels.find(m => m.id.toLowerCase().includes(keyword))
    if (found) return found.id
  }

  // 回退到第一个可用的聊天模型
  return chatModels[0].id
}

// ─── Message Format Conversion ────────────────────────────────

/**
 * 将 Anthropic Messages API 格式的消息转换为 OpenAI-compatible 格式。
 */
function anthropicToMlxMessages(
  anthropicMessages: Array<{
    role: string
    content: string | Array<Record<string, unknown>>
  }>,
  systemPrompt?: string,
): MLXChatMessage[] {
  const messages: MLXChatMessage[] = []

  // System prompt
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }

  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        messages.push({ role: 'user', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text as string })
          } else if (block.type === 'image') {
            const source = block.source as { type: string; media_type?: string; data?: string }
            if (source.type === 'base64' && source.data && source.media_type) {
              parts.push({
                type: 'image_url',
                image_url: {
                  url: `data:${source.media_type};base64,${source.data}`,
                },
              })
            }
          } else if (block.type === 'tool_result') {
            const toolResult = block as { tool_use_id: string; content: string | Array<Record<string, unknown>>; is_error?: boolean }
            const content = typeof toolResult.content === 'string'
              ? toolResult.content
              : Array.isArray(toolResult.content)
                ? toolResult.content.map(c => (c as { text?: string }).text || '').join('\n')
                : ''
            messages.push({
              role: 'tool',
              content,
              tool_call_id: toolResult.tool_use_id,
            })
          }
        }
        if (parts.length > 0) {
          messages.push({
            role: 'user',
            content: parts as MLXChatMessage['content'],
          })
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        messages.push({ role: 'assistant', content: msg.content })
      } else if (Array.isArray(msg.content)) {
        let textContent = ''
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textContent += (block as { text: string }).text
          } else if (block.type === 'tool_use') {
            const tb = block as { id: string; name: string; input: Record<string, unknown> }
            toolCalls.push({ id: tb.id, name: tb.name, input: tb.input })
          }
        }

        const mlxMsg: MLXChatMessage = { role: 'assistant', content: textContent || '' }
        if (toolCalls.length > 0) {
          // Tool calls go in the content as structured parts
          mlxMsg.content = [
            ...(textContent ? [{ type: 'text' as const, text: textContent }] : []),
            ...toolCalls.map(tc => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          ]
        }
        messages.push(mlxMsg)
      }
    }
  }

  return messages
}

/**
 * 将 Anthropic tool_choice 格式转换为 MLX/OpenAI 兼容格式。
 * Anthropic: {type: 'auto' | 'any' | 'tool', name?: string}
 * OpenAI:   'auto' | 'any' | 'none' | {type: 'function', function: {name: string}}
 */
/**
 * 将 Anthropic 工具定义转换为 OpenAI-compatible 格式。
 */
function anthropicToMlxTools(
  tools: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>,
): MLXToolDefinition[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

// ─── Core API Calls ────────────────────────────────────────────

export interface FusionMlxCallOptions {
  model: string
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
  system?: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
  /**
   * 结构化输出 Schema（OpenAI response_format）。
   * 当设置后，模型输出将被强制约束为符合该 Schema 的 JSON。
   * 用于替代脆弱的 prompt 约束 + 正则解析工具调用。
   */
  response_format?: MLXChatCompletionRequest['response_format']
}

/**
 * 调用 fusion-mlx 进行非流式推理。
 * 返回兼容 Anthropic Messages API 格式的响应。
 */
export async function queryFusionMlx(
  options: FusionMlxCallOptions,
): Promise<AnthropicNonStreamingResponse> {
  const mlxMessages = anthropicToMlxMessages(options.messages, options.system)
  const mlxTools = options.tools ? anthropicToMlxTools(options.tools) : undefined

  const requestBody: MLXChatCompletionRequest = {
    model: options.model,
    messages: mlxMessages,
    max_tokens: options.max_tokens || 8192,
    temperature: options.temperature ?? 0.3,
    stream: false,
    ...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  }

  logForDebugging(
    `[Fusion-MLX] Query model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
  )

  try {
    const response = await fetch(getMlxApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(
        parseInt(process.env.FUSION_MLX_TIMEOUT_MS || '120000', 10),
      ),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Fusion-MLX API error: ${response.status} ${response.statusText} - ${errorText}`,
      )
    }

    const data = (await response.json()) as MLXChatCompletionResponse
    return transformMLXResponseToAnthropic(data)
  } catch (error) {
    logForDebugging(
      `[Fusion-MLX] Query failed: ${(error as Error).message}`,
    )
    throw error
  }
}

/**
 * 调用 fusion-mlx 进行流式推理。
 * 返回 AsyncGenerator，产出兼容 Anthropic 格式的流式事件。
 */
export async function* streamFusionMlx(
  options: FusionMlxCallOptions,
): AsyncGenerator<AnthropicStreamEvent> {
  const mlxMessages = anthropicToMlxMessages(options.messages, options.system)
  const mlxTools = options.tools ? anthropicToMlxTools(options.tools) : undefined

  const requestBody: MLXChatCompletionRequest = {
    model: options.model,
    messages: mlxMessages,
    max_tokens: options.max_tokens || 8192,
    temperature: options.temperature ?? 0.3,
    stream: true,
    ...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  }

  logForDebugging(
    `[Fusion-MLX] Stream model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
  )

  try {
    const response = await fetch(getMlxApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(
        parseInt(process.env.FUSION_MLX_TIMEOUT_MS || '300000', 10),
      ),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Fusion-MLX API error: ${response.status} ${response.statusText} - ${errorText}`,
      )
    }

    yield* transformMLXStreamToAnthropic(response, options.model)
  } catch (error) {
    logForDebugging(
      `[Fusion-MLX] Stream failed: ${(error as Error).message}`,
    )
    throw error
  }
}

// ─── Embeddings (RAG / KB) ─────────────────────────────────────

/**
 * 调用 fusion-mlx 的 embeddings API 进行文本向量化。
 * 用于知识库检索 (RAG)。
 */
export async function getFusionMlxEmbeddings(
  input: string | string[],
  model?: string,
): Promise<number[][]> {
  const requestBody: MLXEmbeddingRequest = {
    model: model || 'default',
    input,
  }

  try {
    const response = await fetch(getMlxApiUrl('/v1/embeddings'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new Error(
        `Fusion-MLX embeddings error: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as MLXEmbeddingResponse
    return data.data.map(item => item.embedding)
  } catch (error) {
    logForDebugging(
      `[Fusion-MLX] Embeddings failed: ${(error as Error).message}`,
    )
    throw error
  }
}

// ─── Structured Output Helpers ────────────────────────────────

/**
 * 从工具列表动态构建 oneOf 联合 Schema。
 * 用于 response_format 的结构化输出约束，强制模型输出合规的工具调用 JSON。
 *
 * 输出格式：
 * ```json
 * {
 *   "thinking": "string (调用工具前的推理过程)",
 *   "call": {
 *     "tool_name": "read_file",
 *     "arguments": { ... }
 *   }
 * }
 * ```
 *
 * 当工具列表为空或未提供时，返回 undefined（不约束输出格式）。
 */
export function buildToolResponseSchema(
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>,
): MLXChatCompletionRequest['response_format'] | undefined {
  if (!tools || tools.length === 0) return undefined

  const oneOf = tools.map(tool => ({
    type: 'object' as const,
    properties: {
      tool_name: { const: tool.name },
      arguments: cleanSchemaForResponse(tool.input_schema),
    },
    required: ['tool_name', 'arguments'],
    additionalProperties: false,
  }))

  return {
    type: 'json_schema',
    json_schema: {
      name: 'agent_decision',
      description: 'Agent tool call decision with thinking process',
      schema: {
        type: 'object',
        properties: {
          thinking: {
            type: 'string',
            description: 'Reasoning and planning before calling the tool',
          },
          call: {
            oneOf,
          },
        },
        required: ['thinking', 'call'],
        additionalProperties: false,
      },
      strict: true,
    },
  }
}

/**
 * 清洗工具参数 Schema 以适配结构化输出约束。
 * 移除 outlines/xgrammar 可能不兼容的非标准字段。
 */
function cleanSchemaForResponse(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema }
  delete cleaned.$schema
  delete cleaned.additionalProperties
  delete cleaned.definitions
  // 确保所有嵌套 properties 也被清洗
  if (cleaned.properties && typeof cleaned.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(cleaned.properties as Record<string, unknown>)) {
      props[key] = typeof val === 'object' && val !== null
        ? cleanSchemaForResponse(val as Record<string, unknown>)
        : val
    }
    cleaned.properties = props
  }
  return cleaned
}

// ─── Configuration Helpers ─────────────────────────────────────

/**
 * 检查是否应该使用 fusion-mlx 作为 AI 后端。
 * 优先级：环境变量 > 自动检测
 */
export function shouldUseFusionMlx(): boolean {
  // 环境变量强制启用
  if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) {
    return true
  }

  // 环境变量强制禁用
  if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
    return false
  }

  // 默认：如果 FUSION_API_KEY 未设置且 FUSION_MLX_AUTO 启用，则自动检测
  if (
    isEnvTruthy(process.env.FUSION_MLX_AUTO) &&
    !process.env.FUSION_API_KEY
  ) {
    return true // 返回 true 表示优先尝试 MLX
  }

  return false
}

/**
 * 获取默认的 fusion-mlx 模型。
 * 优先使用环境变量 FUSION_MLX_MODEL，否则返回 null（由运行时自动选择）。
 */
export function getDefaultMlxModel(): string | null {
  return process.env.FUSION_MLX_MODEL || null
}

// ─── Anthropic SDK Fetch Adapter ───────────────────────────────

/**
 * 创建兼容 Anthropic SDK 的 fetch 函数。
 * 将 Anthropic Messages API 请求代理到 fusion-mlx 的 /v1/chat/completions。
 *
 * 这样上层代码可以继续使用 Anthropic SDK 的接口，
 * 而实际的 AI 推理由 fusion-mlx 本地完成。
 */
export function createFusionMlxFetch(model: string): typeof globalThis.fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    const baseUrl = getMlxBaseUrl()

    // 拦截 /v1/messages 请求（Anthropic Messages API）
    if (url.includes('/v1/messages')) {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      // 将 Anthropic 格式转换为 MLX 格式
      const mlxMessages = convertAnthropicBodyToMLX(body)

      // MLX 模式：始终用 adapter 模型覆盖，忽略 SDK 传的 model（可能是 claude-sonnet-* 等云端模型名）
      const resolvedModel = model
      // 自动检测图片/视频模型 → 切换到推荐代码模型
      const imageModelKeywords = ['flux', 'skyreels', 'image', 'video', 'ltx', 'a2v', 'v2v', 'r2v', 'klein', 'txt2vid', 'img2vid', 'tts', 'whisper']
      const isImageModel = imageModelKeywords.some(k => resolvedModel.toLowerCase().includes(k))
      const finalModel = isImageModel ? (await getRecommendedCodeModel()) || resolvedModel : resolvedModel
      const mlxBody: MLXChatCompletionRequest = {
        model: finalModel,
        messages: mlxMessages,
        temperature: body.temperature ?? 0.3,
        stream: body.stream === true,
        ...(body.tools?.length > 0
          ? { tools: anthropicToMlxTools(cleanToolList(body.tools)) }
          : {}),
        ...convertToolChoice(body.tool_choice),
        // 禁用推理/思考过程，防止上下文被快速填满
        ...(finalModel.toLowerCase().includes('qwen3.6')
          ? { enable_thinking: false }
          : {}),
        // 限制 max_tokens 防止上下文溢出（MLX 模型输出过长会快速填满窗口）
        max_tokens: Math.min(body.max_tokens || 2048, 4096),
        // 透传 response_format 结构化输出约束
        ...(body.response_format
          ? { response_format: body.response_format }
          : {}),
      }

      // 调用 fusion-mlx
      const mlxResponse = await fetch(
        `${baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mlxBody),
          signal: init?.signal,
        },
      )

      if (!mlxResponse.ok) {
        // 返回 Anthropic SDK 兼容的错误格式
        const errorBody = await mlxResponse.text()
        return new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: `Fusion-MLX error: ${mlxResponse.status} - ${errorBody}`,
            },
          }),
          {
            status: mlxResponse.status,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      if (body.stream) {
        // 流式响应：将 MLX SSE 流转换为 Anthropic SSE 流
        const anthropicStream = transformMLXStreamToAnthropic(mlxResponse, model)
        const { encodeStreamToAnthropicSSE } = await import(
          './fusion-mlx-stream.js'
        )
        return encodeStreamToAnthropicSSE(anthropicStream, mlxResponse)
      }

      // 非流式响应
      const data = (await mlxResponse.json()) as MLXChatCompletionResponse
      const anthropicResponse = transformMLXResponseToAnthropic(data)

      return new Response(JSON.stringify(anthropicResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    // 非 /v1/messages 请求，透传（如模型列表、key 检测等）
    return fetch(input, init)
  }
  return fn as typeof globalThis.fetch
}

/**
 * 将 Anthropic Messages API 请求体转换为 MLX chat completions 消息格式。
 */
function convertAnthropicBodyToMLX(body: Record<string, unknown>): MLXChatMessage[] {
  const messages: MLXChatMessage[] = []

  // 提取 system prompt
  if (body.system) {
    if (typeof body.system === 'string') {
      messages.push({ role: 'system', content: body.system })
    } else if (Array.isArray(body.system)) {
      const text = body.system
        .map((b: Record<string, unknown>) => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
      if (text) {
        messages.push({ role: 'system', content: text })
      }
    }
  }

  // 转换 messages
  const anthropicMessages = body.messages as Array<{
    role: string
    content: string | Array<Record<string, unknown>>
  }> | undefined

  if (anthropicMessages) {
    for (const msg of anthropicMessages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          messages.push({ role: 'user', content: msg.content })
        } else if (Array.isArray(msg.content)) {
          const parts: Array<{ type: string; text?: string } | { type: string; image_url: { url: string } }> = []
          for (const block of msg.content) {
            if (block.type === 'text') {
              parts.push({ type: 'text', text: block.text as string })
            } else if (block.type === 'image' && (block.source as Record<string, unknown>)?.type === 'base64') {
              const src = block.source as { type: string; media_type: string; data: string }
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${src.media_type};base64,${src.data}` },
              })
            } else if (block.type === 'tool_result') {
              const tr = block as { tool_use_id: string; content: string | Array<Record<string, unknown>> }
              const content = typeof tr.content === 'string'
                ? tr.content
                : Array.isArray(tr.content)
                  ? tr.content.map(c => (c as { text?: string }).text || '').join('\n')
                  : ''
              messages.push({ role: 'tool', content, tool_call_id: tr.tool_use_id })
            }
          }
          if (parts.length > 0) {
            messages.push({ role: 'user', content: parts as MLXChatMessage['content'] })
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          messages.push({ role: 'assistant', content: msg.content })
        } else if (Array.isArray(msg.content)) {
          let textContent = ''
          const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

          for (const block of msg.content) {
            if (block.type === 'text') {
              textContent += (block as { text: string }).text
            } else if (block.type === 'tool_use') {
              const tb = block as { id: string; name: string; input: Record<string, unknown> }
              toolCalls.push({ id: tb.id, name: tb.name, input: tb.input })
            }
          }

          if (toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: textContent || '',
              tool_calls: toolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.input),
                },
              })),
            } as MLXChatMessage)
          } else {
            messages.push({ role: 'assistant', content: textContent })
          }
        }
      }
    }
  }

  return messages
}

/**
 * 将 Anthropic tool_choice 格式转换为 MLX/OpenAI 兼容格式。
 * Anthropic: {type: 'auto' | 'any' | 'tool', name?: string}
 * OpenAI:   'auto' | 'any' | 'none' | {type: 'function', function: {name: string}}
 */
function convertToolChoice(toolChoice: unknown): Record<string, unknown> {
  if (!toolChoice || typeof toolChoice !== 'object') return {}
  const tc = toolChoice as Record<string, unknown>
  const type = tc.type as string | undefined

  if (type === 'auto' || type === 'any') {
    return { tool_choice: type }
  }
  if (type === 'tool' && tc.name) {
    return {
      tool_choice: { type: 'function', function: { name: tc.name } },
    }
  }
  return {}
}