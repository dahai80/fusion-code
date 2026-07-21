/**
 * Fusion-MLX 流式响应适配器
 *
 * 将 fusion-mlx 的 SSE 流（OpenAI-compatible /v1/chat/completions）
 * 转换为 Anthropic Messages API 格式的流式事件，
 * 以便复用 fusion-code 现有的流式处理逻辑。
 */

import { createParser } from 'eventsource-parser'
import type { EventSourceParser } from 'eventsource-parser'
import type {
  MLXStreamChunk,
  MLXStreamChunkChoice,
  MLXStreamDelta,
  MLXResponseToolCall,
  MLXUsage,
} from './fusion-mlx-types.js'

// ─── Anthropic-compatible stream event types ──────────────────

export type AnthropicStreamEvent =
  | AnthropicMessageStart
  | AnthropicContentBlockStart
  | AnthropicContentBlockDelta
  | AnthropicContentBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop
  | AnthropicPing

export interface AnthropicMessageStart {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: []
    model: string
    stop_reason: null
    stop_sequence: null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

export interface AnthropicContentBlockStart {
  type: 'content_block_start'
  index: number
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
}

export interface AnthropicContentBlockDelta {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string }
}

export interface AnthropicContentBlockStop {
  type: 'content_block_stop'
  index: number
}

export interface AnthropicMessageDelta {
  type: 'message_delta'
  delta: { stop_reason: string; stop_sequence: string | null }
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export interface AnthropicMessageStop {
  type: 'message_stop'
}

export interface AnthropicPing {
  type: 'ping'
}

// ─── Stream State ─────────────────────────────────────────────

interface StreamState {
  messageId: string
  model: string
  contentIndex: number
  currentToolCall: {
    index: number
    id: string
    name: string
    arguments: string
  } | null
  textBuffer: string
  toolCalls: MLXResponseToolCall[]
  usage: MLXUsage
  finishReason: string | null
}

function createInitialState(model: string): StreamState {
  return {
    messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    model,
    contentIndex: 0,
    currentToolCall: null,
    textBuffer: '',
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finishReason: null,
  }
}

// ─── Main Stream Transformer ───────────────────────────────────

/**
 * 将 fusion-mlx SSE 流转换为 Anthropic 格式的流式事件。
 * 返回一个 AsyncGenerator，产出 AnthropicStreamEvent。
 */
export async function* transformMLXStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const state = createInitialState(model)

  if (!response.body) {
    throw new Error('MLX stream response has no body')
  }

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Parse SSE events
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data) as MLXStreamChunk
          const events = processChunk(parsed, state)
          for (const event of events) {
            yield event
          }
        } catch (e) {
          // Skip unparseable chunks
          continue
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim()
    if (data !== '[DONE]') {
      try {
        const parsed = JSON.parse(data) as MLXStreamChunk
        const events = processChunk(parsed, state)
        for (const event of events) {
          yield event
        }
      } catch {
        // Skip
      }
    }
  }

  // Close any pending content block
  if (state.currentToolCall) {
    // Finalize the tool call
    yield {
      type: 'content_block_delta',
      index: state.contentIndex - 1,
      delta: {
        type: 'input_json_delta',
        partial_json: state.currentToolCall.arguments,
      },
    }
    yield {
      type: 'content_block_stop',
      index: state.contentIndex - 1,
    }
  }

  // Emit message_delta
  const stopReason = mapFinishReason(state.finishReason)
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      input_tokens: state.usage.prompt_tokens,
      output_tokens: state.usage.completion_tokens,
    },
  }

  yield { type: 'message_stop' }
}

function processChunk(
  chunk: MLXStreamChunk,
  state: StreamState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = []

  if ('choices' in chunk && chunk.choices?.length > 0) {
    const choice = chunk.choices[0]

    // Narrow the type — only stream-chunk choices have delta
    if (!('delta' in choice) || !choice.delta) return events
    const delta = choice.delta

    // Handle content text
    if (delta.content) {
      if (!state.textBuffer && !state.currentToolCall) {
        // Start a new text content block
        events.push({
          type: 'content_block_start',
          index: state.contentIndex++,
          content_block: { type: 'text', text: '' },
        })
      }

      if (state.currentToolCall) {
        // Close pending tool call block first
        events.push({
          type: 'content_block_delta',
          index: state.contentIndex - 1,
          delta: {
            type: 'input_json_delta',
            partial_json: state.currentToolCall.arguments,
          },
        })
        events.push({
          type: 'content_block_stop',
          index: state.contentIndex - 1,
        })
        state.currentToolCall = null

        // Start text block
        events.push({
          type: 'content_block_start',
          index: state.contentIndex++,
          content_block: { type: 'text', text: '' },
        })
      }

      state.textBuffer += delta.content
      events.push({
        type: 'content_block_delta',
        index: state.contentIndex - 1,
        delta: { type: 'text_delta', text: delta.content },
      })
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.function?.name) {
          // New tool call — close text block if open, emit tool_use start
          if (state.textBuffer) {
            events.push({
              type: 'content_block_stop',
              index: state.contentIndex - 1,
            })
            state.textBuffer = ''
          }

          state.currentToolCall = {
            index: tc.index,
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments || '',
          }

          events.push({
            type: 'content_block_start',
            index: state.contentIndex++,
            content_block: {
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: {},
            },
          })

          // 如果第一个 chunk 就带有 arguments，立即发出 input_json_delta
          if (tc.function?.arguments) {
            events.push({
              type: 'content_block_delta',
              index: state.contentIndex - 1,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            })
          }
        } else if (state.currentToolCall && tc.function?.arguments) {
          // Accumulate tool call arguments
          state.currentToolCall.arguments += tc.function.arguments
          events.push({
            type: 'content_block_delta',
            index: state.contentIndex - 1,
            delta: {
              type: 'input_json_delta',
              partial_json: tc.function.arguments,
            },
          })
        }
      }
    }

    // Handle finish reason
    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason

      // Close pending content block
      if (state.currentToolCall) {
        events.push({
          type: 'content_block_stop',
          index: state.contentIndex - 1,
        })
        state.currentToolCall = null
      } else if (state.textBuffer) {
        events.push({
          type: 'content_block_stop',
          index: state.contentIndex - 1,
        })
        state.textBuffer = ''
      }
    }
  }

  // Handle usage from final chunk
  if ('usage' in chunk && chunk.usage) {
    state.usage = chunk.usage
  }

  return events
}

// ─── Non-streaming response converter ─────────────────────────

export interface AnthropicNonStreamingResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >
  model: string
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * 将 fusion-mlx 非流式响应转换为 Anthropic Messages API 格式。
 */
export function transformMLXResponseToAnthropic(
  mlxResponse: {
    id: string
    model: string
    choices: Array<{
      message: {
        role: string
        content: string | null
        reasoning_content?: string | null
        tool_calls?: MLXResponseToolCall[]
      }
      finish_reason: string | null
    }>
    usage: MLXUsage
  },
): AnthropicNonStreamingResponse {
  const choice = mlxResponse.choices[0]
  const content: AnthropicNonStreamingResponse['content'] = []

  // MLX models may return content in reasoning_content instead of content
  const textContent = choice.message.content || (choice.message as any).reasoning_content || ''
  if (textContent) {
    content.push({ type: 'text', text: textContent })
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || '{}'),
      })
    }
  }

  return {
    id: mlxResponse.id,
    type: 'message',
    role: 'assistant',
    content,
    model: mlxResponse.model,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: mlxResponse.usage.prompt_tokens,
      output_tokens: mlxResponse.usage.completion_tokens,
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function mapFinishReason(
  reason: string | null,
): 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    default:
      return null
  }
}

// ─── SSE Encode (for fetch adapter) ───────────────────────────

/**
 * 将 AnthropicStreamEvent AsyncGenerator 编码为 SSE 流 Response。
 * 用于 createFusionMlxFetch 中的流式响应处理。
 */
export async function encodeStreamToAnthropicSSE(
  stream: AsyncGenerator<AnthropicStreamEvent>,
  originalResponse: Response,
): Promise<Response> {
  const encoder = new TextEncoder()
  const STREAM_TIMEOUT_MS = 300_000 // 5 minutes max stream duration
  let streamStarted = Date.now()

  const streamBody = new ReadableStream({
    async start(controller) {
      // Timeout safeguard: if the stream doesn't complete within STREAM_TIMEOUT_MS,
      // close it with an error event to prevent the SDK from hanging indefinitely.
      const timeoutHandle = setTimeout(() => {
        try {
          const errorEvent = {
            type: 'error',
            error: {
              type: 'timeout_error',
              message: 'Stream timed out after 5 minutes',
            },
          }
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`),
          )
        } catch {
          // controller may already be closed
        } finally {
          try { controller.close() } catch { /* ignore */ }
        }
      }, STREAM_TIMEOUT_MS)

      try {
        for await (const event of stream) {
          // Reset stream timeout on each event (keep-alive)
          streamStarted = Date.now()
          const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(line))
        }
      } catch (error) {
        // Emit error event
        const errorEvent = {
          type: 'error',
          error: {
            type: 'api_error',
            message: `Stream error: ${(error as Error).message}`,
          },
        }
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`),
          )
        } catch {
          // controller may already be closed
        }
      } finally {
        clearTimeout(timeoutHandle)
        try { controller.close() } catch { /* ignore */ }
      }
    },
  })

  return new Response(streamBody, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...Object.fromEntries(originalResponse.headers.entries()),
    },
  })
}