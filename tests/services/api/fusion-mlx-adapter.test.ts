/**
 * fusion-mlx-adapter 测试
 *
 * 验证：
 * 1. 健康检查 (checkFusionMlxHealth)
 * 2. 模型列表 (getFusionMlxModels)
 * 3. 推荐代码模型 (getRecommendedCodeModel)
 * 4. 非流式查询 (queryFusionMlx)
 * 5. 流式查询 (streamFusionMlx)
 * 6. Embeddings (getFusionMlxEmbeddings)
 * 7. 配置助手 (shouldUseFusionMlx, getDefaultMlxModel)
 * 8. Fetch 适配器 (createFusionMlxFetch)
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import {
  checkFusionMlxHealth,
  getFusionMlxModels,
  getRecommendedCodeModel,
  queryFusionMlx,
  getFusionMlxEmbeddings,
  shouldUseFusionMlx,
  getDefaultMlxModel,
  createFusionMlxFetch,
  _resetOriginalFetch,
} from '../../../src/services/api/fusion-mlx-adapter.js'

// ─── Helpers ──────────────────────────────────────────────────

const DEFAULT_MLX_URL = 'http://127.0.0.1:11434'

beforeEach(() => {
    _resetOriginalFetch()
})

/**
 * Create a mock fetch response.
 */
function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Create a mock SSE stream response.
 */
function mockSSEResponse(lines: string[]): Response {
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

// ─── checkFusionMlxHealth ─────────────────────────────────────

describe('checkFusionMlxHealth', () => {
  beforeEach(() => {
    // Clean env for each test
    delete process.env.FUSION_MLX_BASE_URL
    delete process.env.MLX_BASE_URL
  })

  it('should return available=true when service is healthy', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          object: 'list',
          data: [{ id: 'qwen2.5-coder', object: 'model', created: 100, owned_by: 'local' }],
        })
      }
      return mockResponse({})
    })

    try {
      const result = await checkFusionMlxHealth()
      expect(result.available).toBe(true)
      expect(result.version).toBe('unknown')
      expect(result.models).toContain('qwen2.5-coder')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return available=false when health check fails', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Connection refused')
    })

    try {
      const result = await checkFusionMlxHealth()
      expect(result.available).toBe(false)
      expect(result.models).toEqual([])
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return available=false when models endpoint fails', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return new Response(null, { status: 503 })
      }
      return mockResponse({})
    })

    try {
      const result = await checkFusionMlxHealth()
      expect(result.available).toBe(false)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should use FUSION_MLX_BASE_URL when set', async () => {
    // isAllowedMlxHostname now WARNs (but allows) non-local hosts instead of
    // falling back. Use localhost (allowed, yet distinct from the default) so
    // this asserts the env var is actually honored without triggering the warn.
    process.env.FUSION_MLX_BASE_URL = 'http://localhost:11434'
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calledUrl = String(url)
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [] })
      }
      return mockResponse({})
    })

    try {
      await checkFusionMlxHealth()
      expect(calledUrl).toContain('localhost:11434')
      expect(calledUrl).toContain('/v1/models')
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── getFusionMlxModels ───────────────────────────────────────

describe('getFusionMlxModels', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_BASE_URL
  })

  it('should return model list on success', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          object: 'list',
          data: [
            { id: 'qwen2.5-coder', object: 'model', created: 100, owned_by: 'local' },
            { id: 'deepseek-coder', object: 'model', created: 101, owned_by: 'local', max_input_tokens: 32768 },
          ],
        })
      }
      return mockResponse({})
    })

    try {
      const models = await getFusionMlxModels()
      expect(models).toHaveLength(2)
      expect(models[0].id).toBe('qwen2.5-coder')
      expect(models[1].max_input_tokens).toBe(32768)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return empty array on fetch failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Network error')
    })

    try {
      const models = await getFusionMlxModels()
      expect(models).toEqual([])
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return empty array on non-ok response', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return new Response(null, { status: 500 })
      }
      return mockResponse({})
    })

    try {
      const models = await getFusionMlxModels()
      expect(models).toEqual([])
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── getRecommendedCodeModel ──────────────────────────────────

describe('getRecommendedCodeModel', () => {
  it('should prefer code models', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          object: 'list',
          data: [
            { id: 'llama3.2', object: 'model', created: 100, owned_by: 'local' },
            { id: 'qwen2.5-coder', object: 'model', created: 101, owned_by: 'local' },
          ],
        })
      }
      return mockResponse({})
    })

    try {
      const model = await getRecommendedCodeModel()
      expect(model).toBe('qwen2.5-coder')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return first model if no code model found', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          object: 'list',
          data: [
            { id: 'llama3.2', object: 'model', created: 100, owned_by: 'local' },
          ],
        })
      }
      return mockResponse({})
    })

    try {
      const model = await getRecommendedCodeModel()
      expect(model).toBe('llama3.2')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return null when no models available', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [] })
      }
      return mockResponse({})
    })

    try {
      const model = await getRecommendedCodeModel()
      expect(model).toBeNull()
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── queryFusionMlx ───────────────────────────────────────────

describe('queryFusionMlx', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_TIMEOUT_MS
  })

  it('should return text response for a basic query', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/chat/completions')) {
        const body = JSON.parse((init as RequestInit).body as string)
        expect(body.model).toBe('qwen2.5-coder')
        expect(body.messages).toHaveLength(1)
        expect(body.stream).toBe(false)

        return mockResponse({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 100,
          model: 'qwen2.5-coder',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      }
      return mockResponse({})
    })

    try {
      const result = await queryFusionMlx({
        model: 'qwen2.5-coder',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      expect(result.id).toBe('chatcmpl-123')
      expect(result.content[0]).toHaveProperty('type', 'text')
      expect((result.content[0] as { text: string }).text).toBe('Hello!')
      expect(result.usage.input_tokens).toBe(10)
      expect(result.usage.output_tokens).toBe(5)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should handle tool calls in response', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/chat/completions')) {
        return mockResponse({
          id: 'chatcmpl-456',
          object: 'chat.completion',
          created: 101,
          model: 'deepseek-coder',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        })
      }
      return mockResponse({})
    })

    try {
      const result = await queryFusionMlx({
        model: 'deepseek-coder',
        messages: [{ role: 'user', content: 'Run ls' }],
        tools: [{ name: 'bash', description: 'Run a command', input_schema: { type: 'object', properties: { cmd: { type: 'string' } } } }],
      })
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toHaveProperty('type', 'tool_use')
      expect(result.stop_reason).toBe('tool_use')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should include system prompt in request', async () => {
    let requestBody = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/chat/completions')) {
        requestBody = (init as RequestInit).body as string
        return mockResponse({
          id: 'chatcmpl-789',
          object: 'chat.completion',
          created: 102,
          model: 'test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      }
      return mockResponse({})
    })

    try {
      await queryFusionMlx({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
        system: 'You are a helpful assistant.',
      })
      const body = JSON.parse(requestBody)
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[0].content).toBe('You are a helpful assistant.')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should throw on API error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/chat/completions')) {
        return new Response('Internal error', { status: 500 })
      }
      return mockResponse({})
    })

    try {
      await queryFusionMlx({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      expect(true).toBe(false) // Should not reach here
    } catch (error) {
      expect((error as Error).message).toContain('Fusion-MLX API error')
      expect((error as Error).message).toContain('500')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should handle network failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch failed')
    })

    try {
      await queryFusionMlx({
        model: 'test',
        messages: [{ role: 'user', content: 'Hi' }],
      })
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain('fetch failed')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should work with anthropic-style messages (image content)', async () => {
    let requestBody = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/chat/completions')) {
        requestBody = (init as RequestInit).body as string
        return mockResponse({
          id: 'chatcmpl-img',
          object: 'chat.completion',
          created: 200,
          model: 'test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'I see an image' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        })
      }
      return mockResponse({})
    })

    try {
      await queryFusionMlx({
        model: 'test',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        }],
      })
      const body = JSON.parse(requestBody)
      expect(body.messages[0].content).toBeInstanceOf(Array)
      expect(body.messages[0].content[0].type).toBe('text')
      expect(body.messages[0].content[1].type).toBe('image_url')
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── getFusionMlxEmbeddings ───────────────────────────────────

describe('getFusionMlxEmbeddings', () => {
  it('should return embeddings for a single string', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/embeddings')) {
        return mockResponse({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
          model: 'default',
          usage: { prompt_tokens: 2, total_tokens: 2 },
        })
      }
      return mockResponse({})
    })

    try {
      const result = await getFusionMlxEmbeddings('Hello world')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual([0.1, 0.2, 0.3])
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return embeddings for array input', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/embeddings')) {
        return mockResponse({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
            { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
          ],
          model: 'default',
          usage: { prompt_tokens: 4, total_tokens: 4 },
        })
      }
      return mockResponse({})
    })

    try {
      const result = await getFusionMlxEmbeddings(['Hello', 'World'])
      expect(result).toHaveLength(2)
      expect(result[1]).toEqual([0.3, 0.4])
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should throw on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/embeddings')) {
        return new Response('Error', { status: 500 })
      }
      return mockResponse({})
    })

    try {
      await getFusionMlxEmbeddings('test')
      expect(true).toBe(false)
    } catch (error) {
      expect((error as Error).message).toContain('Fusion-MLX embeddings error')
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── shouldUseFusionMlx ───────────────────────────────────────

describe('shouldUseFusionMlx', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_ENABLED
    delete process.env.FUSION_MLX_DISABLED
    delete process.env.FUSION_MLX_AUTO
  })

  it('should return true when FUSION_MLX_ENABLED is set', () => {
    process.env.FUSION_MLX_ENABLED = '1'
    expect(shouldUseFusionMlx()).toBe(true)
  })

  it('should return false when FUSION_MLX_DISABLED is set', () => {
    process.env.FUSION_MLX_DISABLED = '1'
    expect(shouldUseFusionMlx()).toBe(false)
  })

  it('should return true in auto mode with no API key', () => {
    process.env.FUSION_MLX_AUTO = '1'
    delete process.env.FUSION_API_KEY
    expect(shouldUseFusionMlx()).toBe(true)
  })

  it('should return false in auto mode with API key', () => {
    process.env.FUSION_MLX_AUTO = '1'
    process.env.FUSION_API_KEY = 'sk-test'
    expect(shouldUseFusionMlx()).toBe(false)
  })

  it('should return false by default', () => {
    delete process.env.FUSION_API_KEY
    expect(shouldUseFusionMlx()).toBe(false)
  })
})

// ─── getDefaultMlxModel ───────────────────────────────────────

describe('getDefaultMlxModel', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_MODEL
  })

  it('should return null when not set', () => {
    expect(getDefaultMlxModel()).toBeNull()
  })

  it('should return FUSION_MLX_MODEL when set', () => {
    process.env.FUSION_MLX_MODEL = 'qwen2.5-coder'
    expect(getDefaultMlxModel()).toBe('qwen2.5-coder')
  })
})

// ─── createFusionMlxFetch ─────────────────────────────────────

describe('createFusionMlxFetch', () => {
  it('should return a function', () => {
    const fetchFn = createFusionMlxFetch('test-model')
    expect(typeof fetchFn).toBe('function')
  })

  it('should proxy non-messages requests to global fetch', async () => {
    const fetchFn = createFusionMlxFetch('test-model')
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calledUrl = String(url)
      return mockResponse({ ok: true })
    })

    try {
      const res = await fetchFn('https://example.com/api', { method: 'GET' })
      expect(calledUrl).toBe('https://example.com/api')
      expect(res.ok).toBe(true)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should intercept /v1/messages requests', async () => {
    const fetchFn = createFusionMlxFetch('test-model')

    // Mock the underlying fetch that the adapter calls
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes('/v1/chat/completions')) {
        return mockResponse({
          id: 'chatcmpl-fetch',
          object: 'chat.completion',
          created: 100,
          model: 'test-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Fetch result' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
      }
      return mockResponse({})
    })

    try {
      const res = await fetchFn('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.type).toBe('message')
      expect(data.content[0].text).toBe('Fetch result')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should handle API errors from /v1/messages', async () => {
    const fetchFn = createFusionMlxFetch('test-model')

    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/chat/completions')) {
        return new Response('Service unavailable', { status: 503 })
      }
      return mockResponse({})
    })

    try {
      const res = await fetchFn('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'Hi' }] }),
      })
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data.type).toBe('error')
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should handle streaming via /v1/messages with stream=true', async () => {
    const fetchFn = createFusionMlxFetch('test-model')

    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/v1/chat/completions')) {
        const body = JSON.parse((init as RequestInit).body as string)
        expect(body.stream).toBe(true)
        return mockSSEResponse([
          'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
          'data: [DONE]',
        ])
      }
      return mockResponse({})
    })

    try {
      const res = await fetchFn('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'test',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true,
        }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      const text = await res.text()
      expect(text).toContain('event: message_start')
      expect(text).toContain('event: message_stop')
    } finally {
      mockFetch.mockRestore()
    }
  })
})