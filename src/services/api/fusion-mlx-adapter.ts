/**
 * Fusion-MLX 适配器
 *
 * 将 fusion-code 的 AI 调用从 Anthropic SDK 切换到 fusion-mlx 本地推理引擎。
 * 为上层代码提供兼容 Anthropic Messages API 的接口。
 *
 * fusion-mlx 运行在本地 127.0.0.1:11434，兼容 OpenAI /v1/chat/completions 格式。
 * 本适配器在内部做格式转换，外部保持与现有代码兼容。
 */

import { cleanToolList } from './fusion-mlx-tool-validator.js'
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
const DEFAULT_WARMUP_TIMEOUT_MS = 60_000   // 60s for first inference (model loading)
const DEFAULT_STREAM_TIMEOUT_MS = 300_000  // 5 min for streaming
const DEFAULT_QUERY_TIMEOUT_MS = 120_000   // 2 min for non-streaming
const MAX_RETRIES = 1                       // retry once on connection failure
const MLX_MAX_TOKENS_ESCALATION_RETRIES = 1 // retry once when max_tokens hit
const MLX_MAX_TOKENS_ESCALATION_FACTOR = 2  // double max_tokens on escalation

// ─── Circuit Breaker ──────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half_open'

interface CircuitBreakerConfig {
    failureThreshold: number    // consecutive failures before opening
    cooldownMs: number          // time before half-open probe
    halfOpenMaxProbes: number   // successful probes to close circuit
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    cooldownMs: 30_000,
    halfOpenMaxProbes: 2,
}

class CircuitBreaker {
    private state: CircuitState = 'closed'
    private failureCount = 0
    private successCount = 0
    private lastFailureTime = 0
    private readonly config: CircuitBreakerConfig

    constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {
        this.config = config
    }

    getState(): CircuitState {
        if (this.state === 'open') {
            const elapsed = Date.now() - this.lastFailureTime
            if (elapsed >= this.config.cooldownMs) {
                this.state = 'half_open'
                this.successCount = 0
                logForDebugging('[Fusion-MLX] Circuit breaker: OPEN → HALF_OPEN (cooldown elapsed)')
            }
        }
        return this.state
    }

    allowRequest(): boolean {
        const state = this.getState()
        if (state === 'closed') return true
        if (state === 'half_open') return true
        return false
    }

    recordSuccess(): void {
        if (this.state === 'half_open') {
            this.successCount++
            if (this.successCount >= this.config.halfOpenMaxProbes) {
                this.state = 'closed'
                this.failureCount = 0
                this.successCount = 0
                logForDebugging('[Fusion-MLX] Circuit breaker: HALF_OPEN → CLOSED (probes passed)')
            }
        } else if (this.state === 'closed') {
            this.failureCount = 0
        }
    }

    recordFailure(): void {
        this.failureCount++
        this.lastFailureTime = Date.now()

        if (this.state === 'half_open') {
            this.state = 'open'
            this.successCount = 0
            logForDebugging('[Fusion-MLX] Circuit breaker: HALF_OPEN → OPEN (probe failed)')
        } else if (this.state === 'closed' && this.failureCount >= this.config.failureThreshold) {
            this.state = 'open'
            logForDebugging(`[Fusion-MLX] Circuit breaker: CLOSED → OPEN (${this.failureCount} consecutive failures)`)
        }
    }
}

const mlxApiCircuit = new CircuitBreaker()

// ─── Per-Model Inference Parameters ────────────────────────────

export interface ModelInferenceParams {
    temperature: number
    top_p: number
    top_k?: number
    repetition_penalty?: number
    frequency_penalty?: number
    presence_penalty?: number
    enable_thinking?: boolean
}

export function getModelInferenceParams(modelId: string): ModelInferenceParams {
    const envTemp = process.env.FUSION_MLX_TEMPERATURE
    const envTopP = process.env.FUSION_MLX_TOP_P
    const envThinking = process.env.FUSION_MLX_ENABLE_THINKING
    const envRepPenalty = process.env.FUSION_MLX_REPETITION_PENALTY

    const id = modelId.toLowerCase()

    // Resolve model-specific defaults first
    let modelDefaults: ModelInferenceParams
    if (id.includes('qwen3')) {
        const isLargeModel = /\b(27b|32b|70b|72b)\b/.test(id)
        modelDefaults = {
            temperature: isLargeModel ? 0.2 : 0.3,
            top_p: 0.9,
            repetition_penalty: 1.05,
            enable_thinking: isLargeModel,
        }
    } else if (id.includes('deepseek') || id.includes('coder')) {
        modelDefaults = {
            temperature: 0.1,
            top_p: 0.95,
            repetition_penalty: 1.05,
        }
    } else if (id.includes('llama-3') || id.includes('llama3')) {
        modelDefaults = {
            temperature: 0.2,
            top_p: 0.9,
            repetition_penalty: 1.1,
        }
    } else if (id.includes('gemma') || id.includes('phi')) {
        modelDefaults = {
            temperature: 0.2,
            top_p: 0.9,
            repetition_penalty: 1.1,
        }
    } else if (/\b(0\.5b|1b|1\.5b|2b|3b)\b/.test(id)) {
        modelDefaults = {
            temperature: 0.3,
            top_p: 0.95,
        }
    } else {
        modelDefaults = {
            temperature: 0.3,
            top_p: 0.95,
        }
    }

    // Apply env var overrides on top of model defaults
    const hasEnvOverride = envTemp || envTopP || envThinking !== undefined || envRepPenalty
    if (!hasEnvOverride) return modelDefaults

    return {
        temperature: envTemp ? parseFloat(envTemp) : modelDefaults.temperature,
        top_p: envTopP ? parseFloat(envTopP) : modelDefaults.top_p,
        ...(modelDefaults.repetition_penalty || envRepPenalty
            ? { repetition_penalty: envRepPenalty ? parseFloat(envRepPenalty) : modelDefaults.repetition_penalty }
            : {}),
        ...(modelDefaults.top_k ? { top_k: modelDefaults.top_k } : {}),
        ...(modelDefaults.frequency_penalty ? { frequency_penalty: modelDefaults.frequency_penalty } : {}),
        ...(modelDefaults.presence_penalty ? { presence_penalty: modelDefaults.presence_penalty } : {}),
        enable_thinking: envThinking !== undefined
            ? isEnvTruthy(envThinking)
            : modelDefaults.enable_thinking,
    }
}

const ALLOWED_MLX_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
])

function isAllowedMlxHostname(hostname: string): boolean {
    if (ALLOWED_MLX_HOSTNAMES.has(hostname)) return true
    // Allow RFC 1918 private ranges
    if (/^10\./.test(hostname)) return true
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return true
    if (/^192\.168\./.test(hostname)) return true
    // Allow .local mDNS hostnames
    if (hostname.endsWith('.local')) return true
    return false
}

function getMlxBaseUrl(): string {
    const url = process.env.FUSION_MLX_BASE_URL ||
        process.env.MLX_BASE_URL ||
        DEFAULT_MLX_BASE_URL
    try {
        const parsed = new URL(url)
        if (!isAllowedMlxHostname(parsed.hostname)) {
            // 用户显式配置远程/公网 fusion-mlx(出差、远程连接、公网大模型回退)时,尊重该配置:
            // 不再强制回退 localhost,仅记录醒目安全告警。云路径 ANTHROPIC_BASE_URL 本就无此
            // 限制且已可指向公网,此处保持一致;MLX 优化特性仍按 provider 维度生效,不为公网单独优化。
            const msg =
                `[Fusion-MLX] SECURITY: Base URL hostname "${parsed.hostname}" is not a local address. ` +
                `All conversation data will be sent to this external server. ` +
                `Proceeding with user-configured FUSION_MLX_BASE_URL (no fallback).`
            console.error(msg)
            logForDebugging(msg, { level: 'warn' })
        }
    } catch {
        console.error(`[Fusion-MLX] Invalid MLX base URL: ${url}, falling back to default`)
        return DEFAULT_MLX_BASE_URL
    }
    return url
}

function getMlxApiUrl(path: string): string {
  const base = getMlxBaseUrl().replace(/\/+$/, '')
  return `${base}${path}`
}

// fusion-mlx 支持可选 API key 鉴权(见 fusion_mlx/middleware/auth.py:
// _verify_api_key_values 在配置了 api_key 后校验 Authorization: Bearer / x-api-key,
// 未配置时 anonymous allowed)。配置后不带凭据的请求会被 401 拒绝。
function getMlxAuthHeaders(): Record<string, string> {
  const apiKey = process.env.FUSION_MLX_API_KEY || process.env.MLX_API_KEY
  if (!apiKey) return {}
  return { Authorization: `Bearer ${apiKey}` }
}

function getMlxTimeout(streaming: boolean): number {
  if (streaming) {
    return parseInt(process.env.FUSION_MLX_TIMEOUT_MS || String(DEFAULT_STREAM_TIMEOUT_MS), 10)
  }
  return parseInt(process.env.FUSION_MLX_TIMEOUT_MS || String(DEFAULT_QUERY_TIMEOUT_MS), 10)
}

/**
 * Fetch with retry on connection failure.
 * Local MLX may be still warming up (loading model weights) on first call.
 */
async function mlxFetchWithRetry(
  url: string,
  init: RequestInit,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  const authHeaders = getMlxAuthHeaders()
  if (Object.keys(authHeaders).length > 0) {
    init = {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...authHeaders },
    }
    logForDebugging('[Fusion-MLX] Attaching Authorization header (FUSION_MLX_API_KEY set)')
  }
  if (!mlxApiCircuit.allowRequest()) {
    throw new Error('[Fusion-MLX] Circuit breaker is OPEN — MLX server unavailable, will retry after cooldown')
  }

  const warmupTimeout = parseInt(
    process.env.FUSION_MLX_WARMUP_TIMEOUT_MS || String(DEFAULT_WARMUP_TIMEOUT_MS),
    10,
  )

  try {
    const response = await fetch(url, init)
    if (response.ok) {
      mlxApiCircuit.recordSuccess()
    } else if (response.status >= 500) {
      mlxApiCircuit.recordFailure()
    }
    return response
  } catch (error) {
    const err = error as Error
    // 用户主动中断(ESC):不重试,立即抛出,让上层 withRetry 转为 APIUserAbortError
    if (init.signal?.aborted) {
      logForDebugging('[Fusion-MLX] Request aborted by user, not retrying')
      throw error
    }

    const isConnectionError =
      err.message?.includes('ECONNREFUSED') ||
      err.message?.includes('ECONNRESET') ||
      err.message?.includes('fetch failed') ||
      err.message?.includes('socket hang up') ||
      err.name === 'AbortError'

    if (isConnectionError) {
      mlxApiCircuit.recordFailure()
    }

    if (retries <= 0 || !isConnectionError) throw error

    logForDebugging(
      `[Fusion-MLX] Connection failed, retrying in 3s (retries left: ${retries}): ${err.message}`,
    )

    // 3s 延迟期间监听用户中断,ESC 立即生效而非等满 3s
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 3000)
      init.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(error)
        },
        { once: true },
      )
    })

    // 重试前再次检查用户是否已中断
    if (init.signal?.aborted) throw error

    // 组合原 signal(保留用户 abort 能力)+ timeout(防卡死)
    const retryInit = {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(warmupTimeout)])
        : AbortSignal.timeout(warmupTimeout),
    }

    try {
      const retryResponse = await fetch(url, retryInit)
      if (retryResponse.ok) {
        mlxApiCircuit.recordSuccess()
      } else if (retryResponse.status >= 500) {
        mlxApiCircuit.recordFailure()
      }
      return retryResponse
    } catch (retryError) {
      mlxApiCircuit.recordFailure()
      if (retries - 1 <= 0) throw retryError
      return mlxFetchWithRetry(url, init, retries - 1)
    }
  }
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
      headers: { ...getMlxAuthHeaders() },
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
      headers: { ...getMlxAuthHeaders() },
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

  // 排除非聊天模型：图片/视频生成、编码器/transformer/vae 等基础组件、base 预训练
  const excludeKeywords = [
    'flux', 'skyreels', 'image', 'video', 'ltx', 'a2v', 'v2v', 'r2v', 'klein',
    'txt2vid', 'img2vid', 'tts', 'whisper', 'embed', 'bge',
    'encoder', 'transformer', 'vae', 'base', 'pretrain',
  ]
  const chatModels = models.filter(m => !excludeKeywords.some(k => m.id.toLowerCase().includes(k)))
  if (chatModels.length === 0) return models[0].id

  // 按 token 切分匹配，避免 'code' 子串误命中 'encoder'（e-n-code-r）
  const tokensOf = (id: string): string[] => id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  // 从 id 估算参数量（十亿），如 32b/1b/0.6b/27b；无法判断返回 0
  const sizeOf = (id: string): number => {
    const m = id.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/)
    return m ? parseFloat(m[1]) : 0
  }

  // 排除过小模型（≤3B）：无法可靠工具调用，/init 等会输出工具定义而非调用
  const capable = chatModels.filter(m => {
    const size = sizeOf(m.id)
    return size === 0 || size > 3
  })
  const pool = capable.length > 0 ? capable : chatModels

  // 优先代码专用模型（coder/code/codestral），按参数量降序取最大
  const codeTokens = ['coder', 'code', 'codestral']
  const codeModels = pool.filter(m => tokensOf(m.id).some(t => codeTokens.includes(t)))
  if (codeModels.length > 0) {
    codeModels.sort((a, b) => sizeOf(b.id) - sizeOf(a.id))
    logForDebugging(`[Fusion-MLX] Recommended code model: ${codeModels[0].id} (${codeModels.length} code candidates)`)
    return codeModels[0].id
  }

  // 回退：按参数量降序取最大指令/聊天模型
  pool.sort((a, b) => sizeOf(b.id) - sizeOf(a.id))
  logForDebugging(`[Fusion-MLX] Recommended code model (fallback by size): ${pool[0].id}`)
  return pool[0].id
}

// ─── Model Capabilities ────────────────────────────────────────────

export interface MlxModelCapabilities {
  supportsToolCalling: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  maxContextTokens: number
  maxOutputTokens: number
  isSmallModel: boolean   // ≤3B parameters
  isMediumModel: boolean  // 7-9B parameters
  supportsStructuredOutput: boolean  // json_schema response_format
}

let cachedCapabilities: Map<string, MlxModelCapabilities> = new Map()

/**
 * Detect capabilities of a specific MLX model.
 * Uses model name heuristics + API-reported metadata.
 */
export async function getMlxModelCapabilities(modelId: string): Promise<MlxModelCapabilities> {
  if (cachedCapabilities.has(modelId)) {
    return cachedCapabilities.get(modelId)!
  }

  const id = modelId.toLowerCase()
  const models = await getFusionMlxModels()
  const modelInfo = models.find(m => m.id === modelId || m.id.includes(modelId))

  // Size heuristics from model ID
  const isSmallModel = /\b(0\.5b|1b|2b|3b)\b/.test(id)
  const isMediumModel = /\b(7b|8b|9b)\b/.test(id)

  // Tool calling: most instruct/chat models support it; base models don't
  const baseModelKeywords = ['base', 'pt', 'pretrain']
  const isBaseModel = baseModelKeywords.some(k => id.includes(k))
  const supportsToolCalling = !isBaseModel && !isSmallModel

  // Structured output (json_schema response_format): supported by models with grammar/constraint engines
  const structuredKeywords = ['qwen3', 'qwen2.5', 'llama-3', 'llama3', 'mistral', 'gemma', 'phi-4', 'phi4']
  const supportsStructuredOutput = !isBaseModel && !isSmallModel &&
    structuredKeywords.some(k => id.includes(k))

  // Vision: only models with image/vision keywords
  const visionKeywords = ['vision', 'vl', 'llava', 'qwen2-vl', 'pixtral', 'minicpm-v', 'internvl']
  const supportsVision = visionKeywords.some(k => id.includes(k))

  // Context length from API or heuristics
  const maxContextTokens = modelInfo?.max_input_tokens || (isSmallModel ? 16384 : 32768)
  const maxOutputTokens = modelInfo?.max_output_tokens || (isSmallModel ? 2048 : 4096)

  const caps: MlxModelCapabilities = {
    supportsToolCalling,
    supportsStreaming: true,
    supportsVision,
    maxContextTokens,
    maxOutputTokens,
    isSmallModel,
    isMediumModel,
    supportsStructuredOutput,
  }

  cachedCapabilities.set(modelId, caps)
  logForDebugging(`[Fusion-MLX] Capabilities for ${modelId}: ${JSON.stringify(caps)}`)
  return caps
}

/**
 * Clear cached capabilities (call on model switch).
 */
export function clearMlxCapabilitiesCache(): void {
  cachedCapabilities.clear()
}

// ─── Message Format Conversion ────────────────────────────────

/**
 * 将 Anthropic Messages API 格式转换为 OpenAI-compatible MLX 消息格式。
 *
 * System prompt 支持两种形式：
 *   - 字符串（来自 queryFusionMlx/streamFusionMlx 的 options.system）
 *   - Anthropic 数组格式（来自 createFusionMlxFetch 的 body.system）
 *
 * Tool calls 统一输出为 OpenAI tool_calls 格式（非 content 内嵌）。
 */
function anthropicToMlxMessages(
  anthropicMessages: Array<{
    role: string
    content: string | Array<Record<string, unknown>>
  }>,
  systemPrompt?: string | Array<Record<string, unknown>>,
): MLXChatMessage[] {
  const messages: MLXChatMessage[] = []

  // System prompt — split on DYNAMIC_BOUNDARY for KV cache prefix reuse
  if (systemPrompt) {
    let systemText: string
    if (typeof systemPrompt === 'string') {
      systemText = systemPrompt
    } else if (Array.isArray(systemPrompt)) {
      systemText = systemPrompt
        .map((b: Record<string, unknown>) => (b.type === 'text' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
    } else {
      systemText = ''
    }

    if (systemText) {
      const boundaryIdx = systemText.indexOf('SYSTEM_PROMPT_DYNAMIC_BOUNDARY')
      if (boundaryIdx !== -1) {
        const staticPrefix = systemText.slice(0, boundaryIdx).trim()
        const dynamicSuffix = systemText.slice(boundaryIdx + 'SYSTEM_PROMPT_DYNAMIC_BOUNDARY'.length).trim()
        // Log prefix boundary for KV cache optimization tracking
        logForDebugging(
          `[Fusion-MLX] System prompt split: static=${staticPrefix.length} chars, dynamic=${dynamicSuffix.length} chars`,
        )
        // Combine — MLX API uses single system message; prefix ordering still benefits KV cache
        // when fusion-mlx server adds cache-aware API, we can send as separate cached/uncached blocks
        messages.push({ role: 'system', content: staticPrefix + '\n' + dynamicSuffix })
      } else {
        messages.push({ role: 'system', content: systemText })
      }
    }
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
            const toolResult = block as { tool_use_id: string; content: string | Array<Record<string, unknown>> }
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

  return messages
}

/**
 * 将 Anthropic tool_choice 格式转换为 MLX/OpenAI 兼容格式。
 * Anthropic: {type: 'auto' | 'any' | 'tool', name?: string}
 * OpenAI:   'auto' | 'any' | 'none' | {type: 'function', function: {name: string}}
 */
/**
 * 将 Anthropic 工具定义转换为 OpenAI-compatible 格式，同时清洗 Schema。
 */
function anthropicToMlxTools(
  tools: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>,
): MLXToolDefinition[] {
  const cleaned = cleanToolList(tools) as Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>
  return cleaned.map(tool => ({
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

  const inferenceParams = getModelInferenceParams(options.model)

  const requestBody: MLXChatCompletionRequest = {
    model: options.model,
    messages: mlxMessages,
    max_tokens: options.max_tokens || 8192,
    temperature: options.temperature ?? inferenceParams.temperature,
    top_p: inferenceParams.top_p,
    ...(inferenceParams.repetition_penalty ? { repetition_penalty: inferenceParams.repetition_penalty } : {}),
    ...(inferenceParams.enable_thinking !== undefined ? { enable_thinking: inferenceParams.enable_thinking } : {}),
    stream: false,
    ...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  }

  logForDebugging(
    `[Fusion-MLX] Query model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
  )

  try {
    const response = await mlxFetchWithRetry(getMlxApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(getMlxTimeout(false)),
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

  const inferenceParams = getModelInferenceParams(options.model)

  const requestBody: MLXChatCompletionRequest = {
    model: options.model,
    messages: mlxMessages,
    max_tokens: options.max_tokens || 8192,
    temperature: options.temperature ?? inferenceParams.temperature,
    top_p: inferenceParams.top_p,
    ...(inferenceParams.repetition_penalty ? { repetition_penalty: inferenceParams.repetition_penalty } : {}),
    ...(inferenceParams.enable_thinking !== undefined ? { enable_thinking: inferenceParams.enable_thinking } : {}),
    stream: true,
    ...(mlxTools && mlxTools.length > 0 ? { tools: mlxTools } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
  }

  logForDebugging(
    `[Fusion-MLX] Stream model=${options.model} messages=${mlxMessages.length} tools=${mlxTools?.length ?? 0}`,
  )

  try {
    const response = await mlxFetchWithRetry(getMlxApiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(getMlxTimeout(true)),
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
        ...getMlxAuthHeaders(),
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

    // count_tokens 请求：转发到 fusion-mlx /v1/messages/count_tokens 精确计数（不生成）
    // fusion-mlx 用 loaded engine tokenizer + 同 /v1/messages chat template 计数(F12),claude- 别名 pass through
    if (url.includes('/v1/messages/count_tokens')) {
      let countBody: Record<string, unknown> = {}
      if (init?.body) {
        try {
          countBody = JSON.parse(init.body as string)
        } catch (e) {
          logForDebugging(`[Fusion-MLX] count_tokens body parse failed: ${(e as Error).message}`)
          return new Response(JSON.stringify({ input_tokens: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
      }
      try {
        // 透传 Anthropic body：fusion-mlx count_tokens 端点用 Anthropic 格式 + loaded model tokenizer
        const resp = await mlxFetchWithRetry(
          `${baseUrl}/v1/messages/count_tokens`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(countBody),
            signal: init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
          },
        )
        if (resp.ok) {
          const data = (await resp.json()) as { input_tokens?: number }
          logForDebugging(`[Fusion-MLX] count_tokens: ${data.input_tokens ?? JSON.stringify(data)}`)
          if (typeof data.input_tokens === 'number') {
            return new Response(JSON.stringify({ input_tokens: data.input_tokens }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
        }
        const errText = await resp.text().catch(() => '')
        logForDebugging(`[Fusion-MLX] count_tokens endpoint failed (${resp.status}), trying chat completions`)
      } catch (e) {
        logForDebugging(`[Fusion-MLX] count_tokens endpoint error: ${(e as Error).message}`)
      }
      // fallback 1：/v1/chat/completions max_tokens=1 拿 usage.prompt_tokens(精确,有 prefill 开销)
      try {
        const mlxMessages = anthropicToMlxMessages(
          (countBody.messages as Array<{ role: string; content: string | Array<Record<string, unknown>> }>) || [],
          countBody.system as string | Array<Record<string, unknown>> | undefined,
        )
        const toolsForMlx = countBody.tools?.length > 0 ? anthropicToMlxTools(countBody.tools) : undefined
        const chatResp = await mlxFetchWithRetry(
          `${baseUrl}/v1/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: mlxMessages,
              max_tokens: 1,
              stream: false,
              ...(toolsForMlx ? { tools: toolsForMlx } : {}),
            }),
            signal: init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
          },
        )
        if (chatResp.ok) {
          const chatData = (await chatResp.json()) as { usage?: { prompt_tokens?: number } }
          const promptTokens = chatData.usage?.prompt_tokens
          if (typeof promptTokens === 'number') {
            logForDebugging(`[Fusion-MLX] count_tokens via chat completions: ${promptTokens}`)
            return new Response(JSON.stringify({ input_tokens: promptTokens }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
        }
        logForDebugging(`[Fusion-MLX] count_tokens chat completions failed (${chatResp.status})`)
      } catch (e) {
        logForDebugging(`[Fusion-MLX] count_tokens chat completions error: ${(e as Error).message}`)
      }
      // fallback 2：bytes/4 估算(最终兜底,保 token budget 跟踪可用)
      const estInput = Math.ceil(JSON.stringify(countBody.messages ?? []).length / 4)
      logForDebugging(`[Fusion-MLX] count_tokens fallback bytes/4: ${estInput}`)
      return new Response(JSON.stringify({ input_tokens: estInput }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    // 拦截 /v1/messages 请求（Anthropic Messages API）
    if (url.includes('/v1/messages')) {
      let body: Record<string, unknown> = {}
      if (init?.body) {
        try {
          body = JSON.parse(init.body as string)
        } catch (e) {
          console.error('[Fusion-MLX] Failed to parse request body:', (e as Error).message)
          return new Response(JSON.stringify({ error: 'Invalid request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      // 将 Anthropic 格式转换为 MLX 格式
      const mlxMessages = anthropicToMlxMessages(
        (body.messages as Array<{ role: string; content: string | Array<Record<string, unknown>> }>) || [],
        body.system as string | Array<Record<string, unknown>> | undefined,
      )

      // MLX 模式：始终用 adapter 模型覆盖，忽略 SDK 传的 model（可能是 claude-sonnet-* 等云端模型名）
      const resolvedModel = model
      // 自动检测图片/视频模型 → 切换到推荐代码模型
      const imageModelKeywords = ['flux', 'skyreels', 'image', 'video', 'ltx', 'a2v', 'v2v', 'r2v', 'klein', 'txt2vid', 'img2vid', 'tts', 'whisper']
      const isImageModel = imageModelKeywords.some(k => resolvedModel.toLowerCase().includes(k))
      const finalModel = isImageModel ? (await getRecommendedCodeModel()) || resolvedModel : resolvedModel
      // Auto-inject structured output schema for models that support it
      const caps = await getMlxModelCapabilities(finalModel)
      const toolsForMlx = body.tools?.length > 0 ? anthropicToMlxTools(body.tools) : undefined
      const autoResponseFormat = (caps.supportsStructuredOutput && toolsForMlx && toolsForMlx.length > 0 && !body.response_format)
        ? buildToolResponseSchema(body.tools)
        : undefined

      const inferenceParams = getModelInferenceParams(finalModel)

      const mlxBody: MLXChatCompletionRequest = {
        model: finalModel,
        messages: mlxMessages,
        temperature: body.temperature ?? inferenceParams.temperature,
        top_p: inferenceParams.top_p,
        ...(inferenceParams.repetition_penalty ? { repetition_penalty: inferenceParams.repetition_penalty } : {}),
        stream: body.stream === true,
        ...(toolsForMlx ? { tools: toolsForMlx } : {}),
        ...convertToolChoice(body.tool_choice),
        // Qwen3 思考模式：优先尊重请求 thinking 参数（/think 开关），否则按模型启发式（27B+ 自动启用）
        ...((body.thinking as { type?: string } | undefined)?.type
          ? { enable_thinking: (body.thinking as { type: string }).type === 'enabled' }
          : inferenceParams.enable_thinking !== undefined
            ? { enable_thinking: inferenceParams.enable_thinking }
            : {}),
        // max_tokens: use the value from the caller, default 8192
        // No artificial cap — let the model and context window decide
        max_tokens: body.max_tokens || 8192,
        // Structured output: auto-injected or caller-provided
        ...(body.response_format
          ? { response_format: body.response_format }
          : autoResponseFormat
            ? { response_format: autoResponseFormat }
            : {}),
      }

      // 调用 fusion-mlx with retry support
      const mlxResponse = await mlxFetchWithRetry(
        `${baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mlxBody),
          signal: init?.signal || AbortSignal.timeout(getMlxTimeout(mlxBody.stream)),
        },
      )

      if (!mlxResponse.ok) {
        // 返回 Anthropic SDK 兼容的错误格式
        const errorBody = await mlxResponse.text()
        // 转发 Retry-After 头,让上层 withRetry 精确退避(429 等限流场景)
        const errorHeaders: Record<string, string> = { 'content-type': 'application/json' }
        const retryAfter = mlxResponse.headers.get('retry-after')
        if (retryAfter) errorHeaders['retry-after'] = retryAfter
        // fusion-mlx memory_guard 撞顶是确定性失败(同上下文重试必再次 OOM):
        // 标记 x-should-retry:false,让 Anthropic SDK 与 withRetry 都立即放弃重试,
        // 避免空转重试耗满 30+ 分钟(3 次失败 × 每次 prefill ~4min)。
        if (errorBody.includes('memory limit exceeded') || errorBody.includes('Reduce context size')) {
          errorHeaders['x-should-retry'] = 'false'
          logForDebugging(
            `[Fusion-MLX] memory_guard 撞顶(status ${mlxResponse.status}),标记 x-should-retry:false 阻止重试`,
            { level: 'warn' },
          )
        }
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
            headers: errorHeaders,
          },
        )
      }

      if (body.stream) {
        // 流式响应：将 MLX SSE 流转换为 Anthropic SSE 流
        // MLX 流式首块无 usage,用 bytes/4 估算 input_tokens 填 message_start(B task 后改进为精确计数)
        const inputTokensEst = Math.ceil(JSON.stringify(mlxBody.messages).length / 4)
        logForDebugging(
          `[Fusion-MLX] Stream message_start input_tokens estimate: ${inputTokensEst}`,
        )
        const anthropicStream = transformMLXStreamToAnthropic(
          mlxResponse,
          model,
          inputTokensEst,
        )
        const { encodeStreamToAnthropicSSE } = await import(
          './fusion-mlx-stream.js'
        )
        return encodeStreamToAnthropicSSE(anthropicStream, mlxResponse)
      }

      // 非流式响应 — max_tokens escalation on truncation
      const data = (await mlxResponse.json()) as MLXChatCompletionResponse
      const finishReason = data.choices?.[0]?.finish_reason
      const currentMaxTokens = mlxBody.max_tokens

      if (finishReason === 'length' && currentMaxTokens) {
        const escalatedMaxTokens = Math.min(
          currentMaxTokens * MLX_MAX_TOKENS_ESCALATION_FACTOR,
          caps.maxOutputTokens,
        )
        if (escalatedMaxTokens > currentMaxTokens) {
          logForDebugging(
            `[Fusion-MLX] max_tokens hit (${currentMaxTokens}), escalating to ${escalatedMaxTokens}`,
          )
          const escalatedBody = { ...mlxBody, max_tokens: escalatedMaxTokens }
          try {
            const retryResp = await mlxFetchWithRetry(
              `${baseUrl}/v1/chat/completions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(escalatedBody),
                signal: init?.signal || AbortSignal.timeout(getMlxTimeout(false)),
              },
            )
            if (retryResp.ok) {
              const retryData = (await retryResp.json()) as MLXChatCompletionResponse
              const retryAnthropic = transformMLXResponseToAnthropic(retryData)
              return new Response(JSON.stringify(retryAnthropic), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
            logForDebugging(
              `[Fusion-MLX] Escalation retry failed (${retryResp.status}), returning original`,
            )
          } catch (retryErr) {
            logForDebugging(
              `[Fusion-MLX] Escalation retry error: ${(retryErr as Error).message}`,
            )
          }
        }
      }

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