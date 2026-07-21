/**
 * fusion-mlx-models 测试
 *
 * 验证：
 * 1. getLocalModels — 本地模型列表
 * 2. getRecommendedCodeModel — 推荐代码模型
 * 3. getRecommendedFastModel — 推荐快速模型
 * 4. modelSupportsTools — 工具支持检查
 * 5. clearModelCache — 缓存清除
 * 6. getDefaultModelStrategy — 默认策略
 */
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import {
  getLocalModels,
  getRecommendedCodeModel,
  getRecommendedFastModel,
  modelSupportsTools,
  clearModelCache,
  getDefaultModelStrategy,
} from '../../../src/utils/model/fusion-mlx-models.js'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── getLocalModels ──────────────────────────────────────────

describe('getLocalModels', () => {
  beforeEach(() => {
    clearModelCache()
    delete process.env.FUSION_MLX_BASE_URL
  })

  it('should return static configs when MLX is unavailable', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable')
    })

    const models = await getLocalModels()
    expect(models.length).toBeGreaterThan(0)
    // Should include static configs
    expect(models.some(m => m.id === 'qwen2.5-coder')).toBe(true)
    expect(models.some(m => m.id === 'deepseek-coder')).toBe(true)
    expect(models.some(m => m.id === 'codestral')).toBe(true)
    expect(models.some(m => m.id === 'llama3.2')).toBe(true)
    expect(models.some(m => m.id === 'phi3')).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return merged models from MLX when available', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          object: 'list',
          data: [
            { id: 'qwen2.5-coder', object: 'model', created: 100, owned_by: 'local', max_input_tokens: 65536, max_output_tokens: 8192 },
            { id: 'custom-model', object: 'model', created: 101, owned_by: 'local' },
          ],
        })
      }
      return mockResponse({})
    })

    const models = await getLocalModels()
    expect(models.length).toBeGreaterThanOrEqual(2)
    const qwen = models.find(m => m.id === 'qwen2.5-coder')
    expect(qwen).toBeDefined()
    expect(qwen!.maxInputTokens).toBe(65536) // From MLX response
    expect(qwen!.name).toBe('MLX 代码模型') // From static config merge (code model has higher priority)
    expect(qwen!.recommendedForCode).toBe(true) // From static config merge

    const custom = models.find(m => m.id === 'custom-model')
    expect(custom).toBeDefined()
    expect(custom!.name).toBe('custom-model') // Fallback to id
    mockFetch.mockRestore()
  })

  it('should cache results after first call', async () => {
    let callCount = 0
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [] })
      }
      return mockResponse({})
    })

    await getLocalModels()
    expect(callCount).toBeGreaterThan(0)

    const countBefore = callCount
    await getLocalModels()
    expect(callCount).toBe(countBefore) // No additional calls
    mockFetch.mockRestore()
  })
})

// ─── getRecommendedCodeModel ─────────────────────────────────

describe('getRecommendedCodeModel', () => {
  beforeEach(() => {
    clearModelCache()
  })

  it('should return a code model when available', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable') // Use static configs
    })

    const model = await getRecommendedCodeModel()
    expect(model).not.toBeNull()
    // Should prefer a code model
    const models = await getLocalModels()
    const codeModel = models.find(m => m.recommendedForCode)
    expect(model).toBe(codeModel?.id)
    mockFetch.mockRestore()
  })

  it('should return first model when no code model', async () => {
    // Force only non-code models
    // We can't easily mock the static configs, so just verify the function returns something
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [{ id: 'llama3.2', object: 'model', created: 100, owned_by: 'local' }] })
      }
      return mockResponse({})
    })

    const model = await getRecommendedCodeModel()
    expect(model).toBe('llama3.2')
    mockFetch.mockRestore()
  })
})

// ─── getRecommendedFastModel ─────────────────────────────────

describe('getRecommendedFastModel', () => {
  beforeEach(() => {
    clearModelCache()
  })

  it('should return fast model when available', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable') // Use static configs
    })

    const model = await getRecommendedFastModel()
    // Phi-3 is marked as fast in static configs
    expect(model).not.toBeNull()
    mockFetch.mockRestore()
  })

  it('should return null when no fast models', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [{ id: 'big-model', object: 'model', created: 100, owned_by: 'local' }] })
      }
      return mockResponse({})
    })

    const model = await getRecommendedFastModel()
    expect(model).toBeNull()
    mockFetch.mockRestore()
  })
})

// ─── modelSupportsTools ──────────────────────────────────────

describe('modelSupportsTools', () => {
  beforeEach(() => {
    clearModelCache()
  })

  it('should return true for code models', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable') // Use static configs
    })

    const supports = await modelSupportsTools('qwen2.5-coder')
    expect(supports).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false for models without tool support', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable') // Use static configs
    })

    const supports = await modelSupportsTools('phi3')
    expect(supports).toBe(false)
    mockFetch.mockRestore()
  })

  it('should return true for unknown models (default)', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [{ id: 'unknown-model', object: 'model', created: 100, owned_by: 'local' }] })
      }
      return mockResponse({})
    })

    const supports = await modelSupportsTools('unknown-model')
    expect(supports).toBe(true) // Default to true
    mockFetch.mockRestore()
  })
})

// ─── clearModelCache ─────────────────────────────────────────

describe('clearModelCache', () => {
  it('should force re-fetch on next call', async () => {
    // First call caches static configs
    clearModelCache()
    const mockFetch1 = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({ object: 'list', data: [{ id: 'test-model', object: 'model', created: 100, owned_by: 'local' }] })
      }
      return mockResponse({})
    })

    const models1 = await getLocalModels()
    expect(models1.length).toBeGreaterThan(0)
    mockFetch1.mockRestore()

    // Clear cache and verify it re-fetches
    clearModelCache()
    let fetchCalled = false
    const mockFetch2 = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        fetchCalled = true
        return mockResponse({ object: 'list', data: [{ id: 'test-model-2', object: 'model', created: 101, owned_by: 'local' }] })
      }
      return mockResponse({})
    })

    const models2 = await getLocalModels()
    // After clearing cache, it should have fetched again
    expect(fetchCalled).toBe(true)
    mockFetch2.mockRestore()
  })
})

// ─── getDefaultModelStrategy ─────────────────────────────────

describe('getDefaultModelStrategy', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_MODEL_STRATEGY
  })

  it('should return "code" by default', () => {
    const strategy = getDefaultModelStrategy()
    expect(strategy).toBe('code')
  })

  it('should return env var value when valid', () => {
    const strategies = ['auto', 'code', 'fast', 'manual'] as const
    for (const s of strategies) {
      process.env.FUSION_MLX_MODEL_STRATEGY = s
      expect(getDefaultModelStrategy()).toBe(s)
    }
  })

  it('should return "code" for invalid env values', () => {
    process.env.FUSION_MLX_MODEL_STRATEGY = 'invalid'
    expect(getDefaultModelStrategy()).toBe('code')
  })
})