/**
 * fusion-ecosystem 测试
 *
 * 验证：
 * 1. checkFusionServices — 服务健康检测
 * 2. searchKnowledgeBase — 知识库搜索
 * 3. indexToKnowledgeBase — 知识库索引
 * 4. getFusionPlugins — 插件列表
 * 5. setFusionPluginState — 插件状态
 * 6. getFusionModels — 模型列表
 * 7. activateFusionModel — 模型激活
 * 8. analyzeCodebase — 代码分析
 * 9. scanCodeSecurity — 安全扫描
 * 10. getEcosystemStatus — 生态状态摘要
 * 11. isFusionEcosystemEnabled — 生态启用检查
 * 12. enhanceContextWithRag — RAG 上下文增强
 */
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import {
  checkFusionServices,
  searchKnowledgeBase,
  indexToKnowledgeBase,
  getFusionPlugins,
  setFusionPluginState,
  getFusionModels,
  activateFusionModel,
  analyzeCodebase,
  scanCodeSecurity,
  getEcosystemStatus,
  isFusionEcosystemEnabled,
  enhanceContextWithRag,
} from '../../../src/services/ecosystem/fusion-ecosystem.js'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── checkFusionServices ──────────────────────────────────────

describe('checkFusionServices', () => {
  beforeEach(() => {
    delete process.env.FUSION_KB_BASE_URL
    delete process.env.FUSION_PLUGINS_BASE_URL
    delete process.env.FUSION_MODEL_HUB_BASE_URL
    delete process.env.FUSION_CODE_MODELIZATION_BASE_URL
    delete process.env.FUSION_SECURITY_BASE_URL
  })

  it('should report all services available when all respond ok', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      return mockResponse({ status: 'ok' })
    })

    try {
      const status = await checkFusionServices()
      expect(status.kb).toBe(true)
      expect(status.plugins).toBe(true)
      expect(status.modelHub).toBe(true)
      expect(status.codeModelization).toBe(true)
      expect(status.security).toBe(true)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should report services unavailable when they fail', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      throw new Error('Connection refused')
    })

    try {
      const status = await checkFusionServices()
      expect(status.kb).toBe(false)
      expect(status.plugins).toBe(false)
      expect(status.modelHub).toBe(false)
      expect(status.codeModelization).toBe(false)
      expect(status.security).toBe(false)
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should report mixed availability', async () => {
    let callCount = 0
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++
      // First call (kb) ok, second (plugins) fails, etc.
      if (callCount === 1 || callCount === 3) {
        return mockResponse({ status: 'ok' })
      }
      throw new Error('Timeout')
    })

    try {
      const status = await checkFusionServices()
      expect(status.kb).toBe(true)
      expect(status.plugins).toBe(false)
      expect(status.modelHub).toBe(true)
      expect(status.codeModelization).toBe(false)
      expect(status.security).toBe(false)
    } finally {
      mockFetch.mockRestore()
    }
  })
})

// ─── searchKnowledgeBase ──────────────────────────────────────

describe('searchKnowledgeBase', () => {
  it('should return search results', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/collections/') && String(url).includes('/search')) {
        return mockResponse({
          results: [
            { id: 'doc_1', content: 'Code snippet 1', metadata: { file_path: '/src/main.ts' }, score: 0.95 },
            { id: 'doc_2', content: 'Code snippet 2', metadata: {}, score: 0.85 },
          ],
        })
      }
      return mockResponse({})
    })

    try {
      const results = await searchKnowledgeBase('how to use fetch', { topK: 2, collection: 'code' })
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('doc_1')
      expect(results[0].score).toBe(0.95)
      expect(results[1].metadata).toEqual({})
    } finally {
      mockFetch.mockRestore()
    }
  })

  it('should return empty array on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Service unavailable')
    })

    const results = await searchKnowledgeBase('test')
    expect(results).toEqual([])
    mockFetch.mockRestore()
  })

  it('should return empty array on non-ok response', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/search')) {
        return new Response(null, { status: 500 })
      }
      return mockResponse({})
    })

    const results = await searchKnowledgeBase('test')
    expect(results).toEqual([])
    mockFetch.mockRestore()
  })
})

// ─── indexToKnowledgeBase ─────────────────────────────────────

describe('indexToKnowledgeBase', () => {
  it('should return true on success', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/documents')) {
        return new Response(null, { status: 201 })
      }
      return mockResponse({})
    })

    const result = await indexToKnowledgeBase('content', { path: '/test.ts' }, 'code')
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/documents')) {
        return new Response(null, { status: 500 })
      }
      return mockResponse({})
    })

    const result = await indexToKnowledgeBase('content', {})
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })

  it('should return false on network error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Network error')
    })

    const result = await indexToKnowledgeBase('content', {})
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── getFusionPlugins ─────────────────────────────────────────

describe('getFusionPlugins', () => {
  it('should return plugin list', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/plugins')) {
        return mockResponse({
          plugins: [
            { id: 'plugin_1', name: 'Test Plugin', version: '1.0.0', description: 'A test plugin', enabled: true, type: 'skill' },
          ],
        })
      }
      return mockResponse({})
    })

    const plugins = await getFusionPlugins()
    expect(plugins).toHaveLength(1)
    expect(plugins[0].name).toBe('Test Plugin')
    expect(plugins[0].enabled).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return empty array on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const plugins = await getFusionPlugins()
    expect(plugins).toEqual([])
    mockFetch.mockRestore()
  })
})

// ─── setFusionPluginState ─────────────────────────────────────

describe('setFusionPluginState', () => {
  it('should return true on success', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/state')) {
        const body = JSON.parse((init as RequestInit).body as string)
        expect(body.enabled).toBe(false)
        return new Response(null, { status: 200 })
      }
      return mockResponse({})
    })

    const result = await setFusionPluginState('plugin_1', false)
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 404 })
    })

    const result = await setFusionPluginState('plugin_x', true)
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── getFusionModels ──────────────────────────────────────────

describe('getFusionModels', () => {
  it('should return model list', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/models')) {
        return mockResponse({
          models: [
            { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', path: '/models/qwen', format: 'mlx', size: '4GB', quantization: '4bit', active: true },
            { id: 'deepseek-coder', name: 'DeepSeek Coder', path: '/models/deepseek', format: 'mlx', size: '6GB', quantization: '4bit', active: false },
          ],
        })
      }
      return mockResponse({})
    })

    const models = await getFusionModels()
    expect(models).toHaveLength(2)
    expect(models[0].active).toBe(true)
    expect(models[1].id).toBe('deepseek-coder')
    mockFetch.mockRestore()
  })

  it('should return empty on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const models = await getFusionModels()
    expect(models).toEqual([])
    mockFetch.mockRestore()
  })
})

// ─── activateFusionModel ──────────────────────────────────────

describe('activateFusionModel', () => {
  it('should return true on success', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/activate')) {
        return new Response(null, { status: 200 })
      }
      return mockResponse({})
    })

    const result = await activateFusionModel('qwen2.5-coder')
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 500 })
    })

    const result = await activateFusionModel('unknown')
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── analyzeCodebase ──────────────────────────────────────────

describe('analyzeCodebase', () => {
  it('should return analysis result', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/analyze')) {
        return mockResponse({
          summary: 'Good codebase',
          dependencies: [{ source: 'a.ts', target: 'b.ts', type: 'import' }],
          issues: [{ severity: 'medium', type: 'complexity', description: 'High complexity', location: 'a.ts:10' }],
          metrics: { total_files: 10, total_lines: 1000, complexity: 5 },
        })
      }
      return mockResponse({})
    })

    const result = await analyzeCodebase('/path/to/code')
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('Good codebase')
    expect(result!.dependencies).toHaveLength(1)
    expect(result!.issues).toHaveLength(1)
    expect(result!.metrics.total_files).toBe(10)
    mockFetch.mockRestore()
  })

  it('should return null on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 500 })
    })

    const result = await analyzeCodebase('/path')
    expect(result).toBeNull()
    mockFetch.mockRestore()
  })
})

// ─── scanCodeSecurity ─────────────────────────────────────────

describe('scanCodeSecurity', () => {
  it('should return scan result', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/scan')) {
        return mockResponse({
          summary: '2 vulnerabilities found',
          vulnerabilities: [
            { severity: 'high', type: 'hardcoded_secret', description: 'API key in code', file: 'config.ts', line: 5, recommendation: 'Use env var' },
          ],
        })
      }
      return mockResponse({})
    })

    const result = await scanCodeSecurity('/path/to/code')
    expect(result).not.toBeNull()
    expect(result!.summary).toBe('2 vulnerabilities found')
    expect(result!.vulnerabilities[0].severity).toBe('high')
    mockFetch.mockRestore()
  })

  it('should return null on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Timeout')
    })

    const result = await scanCodeSecurity('/path')
    expect(result).toBeNull()
    mockFetch.mockRestore()
  })
})

// ─── getEcosystemStatus ───────────────────────────────────────

describe('getEcosystemStatus', () => {
  it('should return combined ecosystem status', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('/v1/health')) return mockResponse({ status: 'ok' })
      if (urlStr.includes('/v1/plugins')) return mockResponse({ plugins: [{ id: 'p1', name: 'P1', version: '1', description: '', enabled: true, type: 'skill' }] })
      if (urlStr.includes('/v1/models')) return mockResponse({ models: [{ id: 'm1', name: 'M1', path: '', format: '', size: '', quantization: '', active: true }] })
      return mockResponse({})
    })

    const status = await getEcosystemStatus()
    expect(status.enabled).toBe(true)
    expect(status.services.kb).toBe(true)
    expect(status.plugins).toHaveLength(1)
    expect(status.models).toHaveLength(1)
    mockFetch.mockRestore()
  })
})

// ─── isFusionEcosystemEnabled ─────────────────────────────────

describe('isFusionEcosystemEnabled', () => {
  beforeEach(() => {
    delete process.env.FUSION_ECOSYSTEM_ENABLED
    delete process.env.FUSION_ECOSYSTEM_DISABLED
  })

  it('should return true by default', () => {
    expect(isFusionEcosystemEnabled()).toBe(true)
  })

  it('should return true when FUSION_ECOSYSTEM_ENABLED is set', () => {
    process.env.FUSION_ECOSYSTEM_ENABLED = '1'
    expect(isFusionEcosystemEnabled()).toBe(true)
  })

  it('should return false when FUSION_ECOSYSTEM_DISABLED is set', () => {
    process.env.FUSION_ECOSYSTEM_DISABLED = '1'
    expect(isFusionEcosystemEnabled()).toBe(false)
  })
})

// ─── enhanceContextWithRag ────────────────────────────────────

describe('enhanceContextWithRag', () => {
  beforeEach(() => {
    delete process.env.FUSION_ECOSYSTEM_DISABLED
    delete process.env.FUSION_ECOSYSTEM_ENABLED
  })

  it('should return context string when KB returns results', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/search')) {
        return mockResponse({
          results: [{ id: 'd1', content: 'Relevant code', metadata: { file_path: '/src/main.ts' }, score: 0.95 }],
        })
      }
      return mockResponse({})
    })

    const context = await enhanceContextWithRag('how to use fetch', '/project')
    expect(context).toContain('<fusion_kb_context>')
    expect(context).toContain('Relevant code')
    expect(context).toContain('95%') // score 0.95
    expect(context).toContain('[参考 1]')
    mockFetch.mockRestore()
  })

  it('should return empty string when no results', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/search')) {
        return mockResponse({ results: [] })
      }
      return mockResponse({})
    })

    const context = await enhanceContextWithRag('unknown query')
    expect(context).toBe('')
    mockFetch.mockRestore()
  })

  it('should return empty string when ecosystem is disabled', async () => {
    process.env.FUSION_ECOSYSTEM_DISABLED = '1'
    const context = await enhanceContextWithRag('test')
    expect(context).toBe('')
  })
})