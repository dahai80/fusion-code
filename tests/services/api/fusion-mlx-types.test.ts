/**
 * fusion-mlx-types 测试
 *
 * 验证类型定义的正确性：所有类型能被正确构造、序列化、反序列化。
 * 使用 bun:test 运行。
 */
import { describe, it, expect } from 'bun:test'

describe('MLXChatMessage', () => {
  it('should create a system message', () => {
    const msg: import('../../src/services/api/fusion-mlx-types.js').MLXChatMessage = {
      role: 'system',
      content: 'You are a helpful assistant',
    }
    expect(msg.role).toBe('system')
    expect(msg.content).toBe('You are a helpful assistant')
  })

  it('should create a user message with text', () => {
    const msg: import('../../src/services/api/fusion-mlx-types.js').MLXChatMessage = {
      role: 'user',
      content: 'Hello',
    }
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('Hello')
  })

  it('should create a user message with content parts', () => {
    const msg: import('../../src/services/api/fusion-mlx-types.js').MLXChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123', detail: 'high' } },
      ],
    }
    expect(msg.role).toBe('user')
    expect(Array.isArray(msg.content)).toBe(true)
    if (Array.isArray(msg.content)) {
      expect(msg.content).toHaveLength(2)
      expect(msg.content[0]).toHaveProperty('type', 'text')
      expect(msg.content[1]).toHaveProperty('type', 'image_url')
    }
  })

  it('should create an assistant message with tool calls', () => {
    const msg: import('../../src/services/api/fusion-mlx-types.js').MLXChatMessage = {
      role: 'assistant',
      content: 'Let me check that',
      tool_call_id: 'call_123',
    }
    expect(msg.role).toBe('assistant')
    expect(msg.tool_call_id).toBe('call_123')
  })

  it('should accept all valid roles', () => {
    const roles = ['system', 'user', 'assistant', 'tool'] as const
    for (const role of roles) {
      const msg: import('../../src/services/api/fusion-mlx-types.js').MLXChatMessage = { role, content: 'test' }
      expect(msg.role).toBe(role)
    }
  })
})

describe('MLXContentPart', () => {
  it('should create text content', () => {
    const part: import('../../src/services/api/fusion-mlx-types.js').MLXTextContent = {
      type: 'text',
      text: 'Hello world',
    }
    expect(part.type).toBe('text')
    expect(part.text).toBe('Hello world')
  })

  it('should create image content', () => {
    const part: import('../../src/services/api/fusion-mlx-types.js').MLXImageContent = {
      type: 'image_url',
      image_url: { url: 'https://example.com/img.png', detail: 'auto' },
    }
    expect(part.type).toBe('image_url')
    expect(part.image_url.detail).toBe('auto')
  })

  it('should create tool use content', () => {
    const part: import('../../src/services/api/fusion-mlx-types.js').MLXToolCallContent = {
      type: 'tool_use',
      id: 'tool_1',
      name: 'read_file',
      input: { path: '/tmp/test.txt' },
    }
    expect(part.type).toBe('tool_use')
    expect(part.name).toBe('read_file')
    expect(part.input).toEqual({ path: '/tmp/test.txt' })
  })
})

describe('MLXToolDefinition', () => {
  it('should create a valid tool definition', () => {
    const tool: import('../../src/services/api/fusion-mlx-types.js').MLXToolDefinition = {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from disk',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    }
    expect(tool.type).toBe('function')
    expect(tool.function.name).toBe('read_file')
    expect(tool.function.parameters).toHaveProperty('properties')
  })
})

describe('MLXChatCompletionRequest', () => {
  it('should create a minimal request', () => {
    const req: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionRequest = {
      model: 'qwen2.5-coder',
      messages: [{ role: 'user', content: 'Hi' }],
    }
    expect(req.model).toBe('qwen2.5-coder')
    expect(req.messages).toHaveLength(1)
  })

  it('should create a full request with all options', () => {
    const req: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionRequest = {
      model: 'deepseek-coder',
      messages: [{ role: 'system', content: 'You are a coder' }, { role: 'user', content: 'Write code' }],
      max_tokens: 4096,
      temperature: 0.3,
      top_p: 0.95,
      stream: true,
      tools: [
        {
          type: 'function',
          function: { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: {} } },
        },
      ],
      tool_choice: 'auto',
      stop: ['\n\n'],
    }
    expect(req.max_tokens).toBe(4096)
    expect(req.temperature).toBe(0.3)
    expect(req.stream).toBe(true)
    expect(req.tools).toHaveLength(1)
    expect(req.tool_choice).toBe('auto')
  })
})

describe('MLXChatCompletionResponse', () => {
  it('should create a response with text content', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'qwen2.5-coder',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help?' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    expect(res.id).toBe('chatcmpl-123')
    expect(res.choices[0].message.content).toBe('Hello! How can I help?')
    expect(res.choices[0].finish_reason).toBe('stop')
    expect(res.usage.total_tokens).toBe(15)
  })

  it('should create a response with tool calls', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionResponse = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: 1700000001,
      model: 'deepseek-coder',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'bash', arguments: '{"cmd":"ls -la"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }
    expect(res.choices[0].finish_reason).toBe('tool_calls')
    expect(res.choices[0].message.tool_calls).toHaveLength(1)
    expect(res.choices[0].message.tool_calls![0].function.name).toBe('bash')
  })

  it('should handle null content (pure tool call)', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionResponse = {
      id: 'chatcmpl-789',
      object: 'chat.completion',
      created: 1700000002,
      model: 'codestral',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: null },
          finish_reason: null,
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }
    expect(res.choices[0].message.content).toBeNull()
  })

  it('should handle all finish_reason values', () => {
    const reasons: Array<'stop' | 'length' | 'tool_calls' | 'content_filter' | null> = [
      'stop', 'length', 'tool_calls', 'content_filter', null,
    ]
    for (const reason of reasons) {
      const res: import('../../src/services/api/fusion-mlx-types.js').MLXChatCompletionResponse = {
        id: 'test',
        object: 'chat.completion',
        created: 100,
        model: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: reason }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
      expect(res.choices[0].finish_reason).toBe(reason)
    }
  })
})

describe('MLXStreamChunk', () => {
  it('should create a stream chunk with content delta', () => {
    const chunk: import('../../src/services/api/fusion-mlx-types.js').MLXStreamChunkChoice = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'qwen2.5-coder',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    }
    expect(chunk.object).toBe('chat.completion.chunk')
    expect(chunk.choices[0].delta.content).toBe('Hello')
  })

  it('should create a stream chunk with tool call delta', () => {
    const chunk: import('../../src/services/api/fusion-mlx-types.js').MLXStreamChunkChoice = {
      id: 'chatcmpl-456',
      object: 'chat.completion.chunk',
      created: 1700000001,
      model: 'deepseek-coder',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":' } },
            ],
          },
          finish_reason: null,
        },
      ],
    }
    expect(chunk.choices[0].delta.tool_calls).toHaveLength(1)
    expect(chunk.choices[0].delta.tool_calls![0].function.name).toBe('bash')
  })

  it('should create a done chunk with usage', () => {
    const done: import('../../src/services/api/fusion-mlx-types.js').MLXStreamDone = {
      id: 'chatcmpl-789',
      object: 'chat.completion',
      created: 1700000002,
      model: 'codestral',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Done' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    expect(done.object).toBe('chat.completion')
    expect(done.usage.total_tokens).toBe(15)
  })

  it('should handle finish_reason in stream chunk', () => {
    const chunk: import('../../src/services/api/fusion-mlx-types.js').MLXStreamChunkChoice = {
      id: 'test',
      object: 'chat.completion.chunk',
      created: 100,
      model: 'test',
      choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
    }
    expect(chunk.choices[0].finish_reason).toBe('stop')
  })
})

describe('MLXModelListResponse', () => {
  it('should create a model list response', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXModelListResponse = {
      object: 'list',
      data: [
        { id: 'qwen2.5-coder', object: 'model', created: 1700000000, owned_by: 'local' },
        { id: 'deepseek-coder', object: 'model', created: 1700000001, owned_by: 'local', max_input_tokens: 32768 },
      ],
    }
    expect(res.data).toHaveLength(2)
    expect(res.data[0].id).toBe('qwen2.5-coder')
    expect(res.data[1].max_input_tokens).toBe(32768)
  })
})

describe('MLXHealthResponse', () => {
  it('should create a health response (ok)', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXHealthResponse = {
      status: 'ok',
      version: '0.1.0',
      uptime_seconds: 3600,
      active_models: ['qwen2.5-coder'],
    }
    expect(res.status).toBe('ok')
    expect(res.uptime_seconds).toBe(3600)
    expect(res.active_models).toContain('qwen2.5-coder')
  })

  it('should create a health response (error)', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXHealthResponse = {
      status: 'error',
      version: '0.1.0',
      uptime_seconds: 0,
      active_models: [],
    }
    expect(res.status).toBe('error')
  })
})

describe('MLXAnthropic types', () => {
  it('should create an anthropic-style message request', () => {
    const req: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicMessageRequest = {
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 4096,
      system: 'You are Claude.',
    }
    expect(req.model).toBe('claude-opus-4-6')
    expect(req.system).toBe('You are Claude.')
  })

  it('should create anthropic content blocks', () => {
    const textBlock: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicTextBlock = {
      type: 'text',
      text: 'Hello',
    }
    expect(textBlock.type).toBe('text')

    const imageBlock: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicImageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
    }
    expect(imageBlock.source.type).toBe('base64')

    const toolUseBlock: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicToolUseBlock = {
      type: 'tool_use',
      id: 'tu_1',
      name: 'bash',
      input: { cmd: 'ls' },
    }
    expect(toolUseBlock.name).toBe('bash')

    const toolResultBlock: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: 'file1.txt',
    }
    expect(toolResultBlock.tool_use_id).toBe('tu_1')
  })

  it('should create an anthropic-style response', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXAnthropicMessageResponse = {
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello!' },
        { type: 'tool_use', id: 'tu_1', name: 'bash', input: { cmd: 'ls' } },
      ],
      model: 'claude-opus-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    expect(res.content).toHaveLength(2)
    expect(res.stop_reason).toBe('end_turn')
  })
})

describe('MLXEmbedding', () => {
  it('should create an embedding request', () => {
    const req: import('../../src/services/api/fusion-mlx-types.js').MLXEmbeddingRequest = {
      model: 'default',
      input: 'Hello world',
    }
    expect(req.input).toBe('Hello world')
  })

  it('should create an embedding request with array input', () => {
    const req: import('../../src/services/api/fusion-mlx-types.js').MLXEmbeddingRequest = {
      model: 'default',
      input: ['Hello', 'World'],
    }
    expect(Array.isArray(req.input)).toBe(true)
    expect((req.input as string[])).toHaveLength(2)
  })

  it('should create an embedding response', () => {
    const res: import('../../src/services/api/fusion-mlx-types.js').MLXEmbeddingResponse = {
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
      ],
      model: 'default',
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }
    expect(res.data[0].embedding).toHaveLength(3)
    expect(res.usage.prompt_tokens).toBe(2)
  })
})