/**
 * fusion-mlx-stream 测试
 *
 * 验证：
 * 1. transformMLXResponseToAnthropic — 非流式响应转换
 * 2. transformMLXStreamToAnthropic — 流式响应转换
 * 3. encodeStreamToAnthropicSSE — SSE 编码
 * 4. mapFinishReason — 完成原因映射
 */
import { describe, it, expect } from 'bun:test'

// Re-import the internal mapFinishReason by testing its public surface
// via transformMLXResponseToAnthropic
import {
  transformMLXResponseToAnthropic,
  type AnthropicNonStreamingResponse,
  type AnthropicStreamEvent,
  encodeStreamToAnthropicSSE,
} from '../../../src/services/api/fusion-mlx-stream.js'

// ─── transformMLXResponseToAnthropic ──────────────────────────

describe('transformMLXResponseToAnthropic', () => {
  it('should convert text-only response', () => {
    const mlxRes = {
      id: 'chatcmpl-123',
      model: 'qwen2.5-coder',
      choices: [
        {
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }

    const result = transformMLXResponseToAnthropic(mlxRes)
    expect(result.id).toBe('chatcmpl-123')
    expect(result.type).toBe('message')
    expect(result.role).toBe('assistant')
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello world' })
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage.input_tokens).toBe(10)
    expect(result.usage.output_tokens).toBe(5)
  })

  it('should convert tool-call response', () => {
    const mlxRes = {
      id: 'chatcmpl-456',
      model: 'deepseek-coder',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function' as const, function: { name: 'bash', arguments: '{"cmd":"ls -la"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }

    const result = transformMLXResponseToAnthropic(mlxRes)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toHaveProperty('type', 'tool_use')
    const tc = result.content[0] as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    expect(tc.name).toBe('bash')
    expect(tc.input).toEqual({ cmd: 'ls -la' })
    expect(result.stop_reason).toBe('tool_use')
  })

  it('should convert text + tool-call response', () => {
    const mlxRes = {
      id: 'chatcmpl-789',
      model: 'codestral',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Let me check',
            tool_calls: [
              { id: 'call_1', type: 'function' as const, function: { name: 'read_file', arguments: '{"path":"/tmp/test"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
    }

    const result = transformMLXResponseToAnthropic(mlxRes)
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Let me check' })
    const tc = result.content[1] as { type: 'tool_use'; name: string }
    expect(tc.name).toBe('read_file')
  })

  it('should handle empty tool_calls arguments', () => {
    const mlxRes = {
      id: 'chatcmpl-000',
      model: 'test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function' as const, function: { name: 'bash', arguments: '' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }

    const result = transformMLXResponseToAnthropic(mlxRes)
    expect(result.content[0]).toHaveProperty('type', 'tool_use')
    expect((result.content[0] as Record<string, unknown>).input).toEqual({})
  })

  it('should handle null content (no text, no tools)', () => {
    const mlxRes = {
      id: 'chatcmpl-null',
      model: 'test',
      choices: [
        {
          message: { role: 'assistant', content: null },
          finish_reason: null,
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }

    const result = transformMLXResponseToAnthropic(mlxRes)
    expect(result.content).toHaveLength(0)
    expect(result.stop_reason).toBeNull()
  })

  it('should map all finish reasons', () => {
    const cases: Array<{ input: string | null; expected: string | null }> = [
      { input: 'stop', expected: 'end_turn' },
      { input: 'length', expected: 'max_tokens' },
      { input: 'tool_calls', expected: 'tool_use' },
      { input: null, expected: null },
      { input: 'content_filter', expected: null },
    ]

    for (const { input, expected } of cases) {
      const result = transformMLXResponseToAnthropic({
        id: 'test',
        model: 'test',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: input }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
      expect(result.stop_reason).toBe(expected)
    }
  })
})

// ─── transformMLXStreamToAnthropic (via SSE simulation) ───────

describe('transformMLXStreamToAnthropic', () => {
  /**
   * Helper: create a mock ReadableStream from SSE data lines.
   */
  function createStreamResponse(lines: string[]): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
        controller.close()
      },
    })
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  /**
   * Helper: collect all events from a transformMLXStreamToAnthropic call.
   */
  async function collectEvents(response: Response): Promise<AnthropicStreamEvent[]> {
    const events: AnthropicStreamEvent[] = []
    // Dynamic import since it's an async generator
    const { transformMLXStreamToAnthropic } = await import(
      '../../../src/services/api/fusion-mlx-stream.js'
    )
    for await (const event of transformMLXStreamToAnthropic(response, 'test-model')) {
      events.push(event)
    }
    return events
  }

  it('should emit message_start as first event', async () => {
    const response = createStreamResponse([
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)
    expect(events[0]).toHaveProperty('type', 'message_start')
    expect((events[0] as { message: { model: string } }).message.model).toBe('test-model')
  })

  it('should emit message_stop as last event', async () => {
    const response = createStreamResponse([
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion","created":1,"model":"test","choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)
    expect(events[events.length - 1]).toHaveProperty('type', 'message_stop')
  })

  it('should handle text content streaming', async () => {
    const response = createStreamResponse([
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"x","object":"chat.completion","created":1,"model":"test","choices":[{"index":0,"message":{"role":"assistant","content":"Hello world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)

    // Should have: message_start → content_block_start(text) → 2× text_delta → content_block_stop → message_delta → message_stop
    const textDeltas = events.filter(e => e.type === 'content_block_delta' && (e as { delta: { type: string } }).delta.type === 'text_delta')
    expect(textDeltas.length).toBeGreaterThanOrEqual(2)
    expect(events.some(e => e.type === 'content_block_start')).toBe(true)
    expect(events.some(e => e.type === 'message_delta')).toBe(true)
  })

  it('should handle tool call streaming', async () => {
    const response = createStreamResponse([
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"bash","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)

    // Should have tool_use content block start
    const toolStarts = events.filter(
      e => e.type === 'content_block_start' && (e as { content_block: { type: string } }).content_block.type === 'tool_use',
    )
    expect(toolStarts.length).toBeGreaterThanOrEqual(1)
    expect(events.some(e => e.type === 'message_delta')).toBe(true)
  })

  it('should handle text then tool call (mixed)', async () => {
    const response = createStreamResponse([
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Let me check"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)

    // Should have text block stop then tool_use block start
    const blockStops = events.filter(e => e.type === 'content_block_stop')
    expect(blockStops.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle empty response body', async () => {
    const body = new ReadableStream({ start(controller) { controller.close() } })
    const response = new Response(body)
    const events = await collectEvents(response)
    expect(events.length).toBeGreaterThanOrEqual(2) // message_start + message_delta + message_stop
    expect(events[0].type).toBe('message_start')
    expect(events[events.length - 1].type).toBe('message_stop')
  })

  it('should handle [DONE] signal', async () => {
    const response = createStreamResponse([
      'data: [DONE]',
    ])
    const events = await collectEvents(response)
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].type).toBe('message_start')
  })

  it('should skip unparseable chunks', async () => {
    const response = createStreamResponse([
      'data: not valid json',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
      'data: [DONE]',
    ])
    const events = await collectEvents(response)
    // Should still get events from the valid chunk
    const textDeltas = events.filter(e => e.type === 'content_block_delta')
    expect(textDeltas.length).toBeGreaterThanOrEqual(1)
  })

  it('should throw on missing body', async () => {
    // A Response with null body (not a ReadableStream)
    const response = new Response(null)
    const { transformMLXStreamToAnthropic } = await import(
      '../../../src/services/api/fusion-mlx-stream.js'
    )

    try {
      for await (const _event of transformMLXStreamToAnthropic(response, 'test')) {
        // Should not reach here
      }
      // If we get here without error, the test should fail
      expect(true).toBe(false) // Should not reach
    } catch (error) {
      expect((error as Error).message).toBe('MLX stream response has no body')
    }
  })
})

// ─── encodeStreamToAnthropicSSE ───────────────────────────────

describe('encodeStreamToAnthropicSSE', () => {
  async function* createTestStream(events: AnthropicStreamEvent[]): AsyncGenerator<AnthropicStreamEvent> {
    for (const event of events) {
      yield event
    }
  }

  it('should encode events as SSE format', async () => {
    const events: AnthropicStreamEvent[] = [
      { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'test', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } },
      { type: 'message_stop' },
    ]

    const originalResponse = new Response(null, { headers: { 'x-custom': 'test' } })
    const result = await encodeStreamToAnthropicSSE(createTestStream(events), originalResponse)

    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toBe('text/event-stream')
    expect(result.headers.get('x-custom')).toBe('test')

    const text = await result.text()
    expect(text).toContain('event: message_start')
    expect(text).toContain('event: message_stop')
    expect(text).toContain('data:')
  })

  it('should handle stream errors gracefully', async () => {
    async function* errorStream(): AsyncGenerator<AnthropicStreamEvent> {
      yield { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'test', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }
      throw new Error('Stream crashed')
    }

    const originalResponse = new Response(null)
    const result = await encodeStreamToAnthropicSSE(errorStream(), originalResponse)

    const text = await result.text()
    expect(text).toContain('event: error')
    expect(text).toContain('Stream crashed')
  })

  it('should emit ping events', async () => {
    async function* pingStream(): AsyncGenerator<AnthropicStreamEvent> {
      yield { type: 'ping' }
      yield { type: 'message_stop' }
    }

    const originalResponse = new Response(null)
    const result = await encodeStreamToAnthropicSSE(pingStream(), originalResponse)
    const text = await result.text()
    expect(text).toContain('event: ping')
  })
})

// ─── Type exports consistency ─────────────────────────────────

describe('type exports', () => {
  it('should export AnthropicNonStreamingResponse correctly', () => {
    // Verify the type is constructible and has the right shape
    const res: AnthropicNonStreamingResponse = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      model: 'qwen2.5-coder',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    expect(res.usage.input_tokens).toBe(10)
    expect(res.usage.output_tokens).toBe(5)
  })

  it('should support cache_creation_input_tokens in usage', () => {
    const res: AnthropicNonStreamingResponse = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'qwen2.5-coder',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 },
    }
    expect(res.usage.cache_creation_input_tokens).toBe(100)
    expect(res.usage.cache_read_input_tokens).toBe(50)
  })
})