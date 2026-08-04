/**
 * offline-mode 测试
 *
 * 验证：
 * 1. getOfflineMode — 离线模式检测 (full/partial/none)
 * 2. getOfflineCapabilities — 能力矩阵
 * 3. shouldSkipCloudApi — 云 API 跳过
 * 4. getOfflineFallbackModel — 回退模型
 * 5. clearOfflineCache — 缓存清除
 * 6. detectOfflineModeAtStartup — 启动时检测
 * 7. isFeatureAvailableInOfflineMode — 功能可用性
 * 8. getOfflineFallbackMessage — 回退消息
 */
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import {
  getOfflineMode,
  getOfflineCapabilities,
  shouldSkipCloudApi,
  getOfflineFallbackModel,
  clearOfflineCache,
  detectOfflineModeAtStartup,
  isFeatureAvailableInOfflineMode,
  getOfflineFallbackMessage,
} from '../../../src/services/offline/offline-mode.js'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── getOfflineMode ──────────────────────────────────────────

describe('getOfflineMode', () => {
  beforeEach(() => {
    delete process.env.FUSION_OFFLINE_MODE
    clearOfflineCache()
  })

  it('should return "full" when FUSION_OFFLINE_MODE is set', async () => {
    process.env.FUSION_OFFLINE_MODE = '1'
    const mode = await getOfflineMode()
    expect(mode).toBe('full')
  })

  it('should return "none" when network is available', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('generate_204')) {
        return new Response(null, { status: 204 })
      }
      return mockResponse({ status: 'ok' })
    })

    const mode = await getOfflineMode()
    expect(mode).toBe('none')
    mockFetch.mockRestore()
  })

  it('should return "partial" when offline but local MLX is available', async () => {
    let callCount = 0
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++
      // First call: network check fails
      if (callCount === 1) {
        throw new Error('Network unreachable')
      }
      // Second call: local MLX health check succeeds
      return mockResponse({ status: 'ok', version: '0.1', uptime_seconds: 100, active_models: ['test'] })
    })

    const mode = await getOfflineMode()
    expect(mode).toBe('partial')
    mockFetch.mockRestore()
  })

  it('should return "full" when offline and no local MLX', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('All unreachable')
    })

    const mode = await getOfflineMode()
    expect(mode).toBe('full')
    mockFetch.mockRestore()
  })

  it('should cache the result', async () => {
    let callCount = 0
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++
      const urlStr = String(url)
      if (urlStr.includes('generate_204')) {
        return new Response(null, { status: 204 })
      }
      return mockResponse({})
    })

    await getOfflineMode()
    expect(callCount).toBe(1) // First call triggers network check

    // Clear the HTTP mock — the cached result should be returned
    mockFetch.mockRestore()
    const mode = await getOfflineMode()
    expect(mode).toBe('none') // Cached value
  })
})

// ─── getOfflineCapabilities ───────────────────────────────────

describe('getOfflineCapabilities', () => {
  beforeEach(() => {
    clearOfflineCache()
    delete process.env.FUSION_OFFLINE_MODE
  })

  it('should return all capabilities in online mode', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('generate_204')) {
        return new Response(null, { status: 204 })
      }
      return mockResponse({ status: 'ok' })
    })

    const caps = await getOfflineCapabilities()
    expect(caps.inference).toBe(true)
    expect(caps.knowledgeBase).toBe(true)
    expect(caps.pluginMarketplace).toBe(true)
    expect(caps.modelDownload).toBe(true)
    expect(caps.codeAnalysis).toBe(true)
    expect(caps.securityScan).toBe(true)
    expect(caps.gitRemote).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return limited capabilities in full offline mode', async () => {
    process.env.FUSION_OFFLINE_MODE = '1'

    // Mock local services for full offline mode
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('11432')) return mockResponse({ status: 'ok' }) // MLX available
      if (urlStr.includes('11435')) return mockResponse({ status: 'ok' }) // KB available
      throw new Error('Service unavailable')
    })

    const caps = await getOfflineCapabilities()
    expect(caps.inference).toBe(true) // MLX available
    expect(caps.knowledgeBase).toBe(true) // KB available
    expect(caps.pluginMarketplace).toBe(false) // Requires network
    expect(caps.modelDownload).toBe(false) // Requires network
    expect(caps.gitRemote).toBe(false) // Requires network
    mockFetch.mockRestore()
  })
})

// ─── shouldSkipCloudApi ──────────────────────────────────────

describe('shouldSkipCloudApi', () => {
  beforeEach(() => {
    delete process.env.FUSION_OFFLINE_MODE
    delete process.env.FUSION_GATEWAY_ENABLED
    delete process.env.FUSION_MLX_ENABLED
    clearOfflineCache()
  })

  it('should return true when FUSION_OFFLINE_MODE is set', () => {
    process.env.FUSION_OFFLINE_MODE = '1'
    expect(shouldSkipCloudApi()).toBe(true)
  })

  it('should return true when FUSION_GATEWAY_ENABLED is set', () => {
    process.env.FUSION_GATEWAY_ENABLED = '1'
    expect(shouldSkipCloudApi()).toBe(true)
  })

  it('should return true when FUSION_MLX_ENABLED is set', () => {
    process.env.FUSION_MLX_ENABLED = '1'
    expect(shouldSkipCloudApi()).toBe(true)
  })

  it('should return false by default', () => {
    expect(shouldSkipCloudApi()).toBe(false)
  })
})

// ─── getOfflineFallbackModel ─────────────────────────────────

describe('getOfflineFallbackModel', () => {
  beforeEach(() => {
    delete process.env.FUSION_MLX_MODEL
  })

  it('should return "default" when not configured', () => {
    expect(getOfflineFallbackModel()).toBe('default')
  })

  it('should return FUSION_MLX_MODEL when set', () => {
    process.env.FUSION_MLX_MODEL = 'qwen2.5-coder'
    expect(getOfflineFallbackModel()).toBe('qwen2.5-coder')
  })
})

// ─── clearOfflineCache ───────────────────────────────────────

describe('clearOfflineCache', () => {
  it('should clear the cached mode', async () => {
    // First call caches the mode
    process.env.FUSION_OFFLINE_MODE = '1'
    const mode1 = await getOfflineMode()
    expect(mode1).toBe('full')

    // Clear cache
    clearOfflineCache()

    // Now re-check with different env
    delete process.env.FUSION_OFFLINE_MODE
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('generate_204')) {
        return new Response(null, { status: 204 })
      }
      return mockResponse({ status: 'ok' })
    })

    const mode2 = await getOfflineMode()
    expect(mode2).toBe('none') // Re-evaluated
    mockFetch.mockRestore()
  })
})

// ─── detectOfflineModeAtStartup ───────────────────────────────

describe('detectOfflineModeAtStartup', () => {
  beforeEach(() => {
    clearOfflineCache()
    delete process.env.FUSION_OFFLINE_MODE
  })

  it('should return message for online mode', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes('generate_204')) {
        return new Response(null, { status: 204 })
      }
      return mockResponse({})
    })

    const result = await detectOfflineModeAtStartup()
    expect(result.mode).toBe('none')
    expect(result.message).toContain('在线模式')
    expect(result.capabilities.inference).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return message for full offline mode', async () => {
    process.env.FUSION_OFFLINE_MODE = '1'
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('11432')) return mockResponse({ status: 'ok' })
      throw new Error('Unreachable')
    })

    const result = await detectOfflineModeAtStartup()
    expect(result.mode).toBe('full')
    expect(result.message).toContain('离线模式')
    mockFetch.mockRestore()
  })
})

// ─── isFeatureAvailableInOfflineMode ──────────────────────────

describe('isFeatureAvailableInOfflineMode', () => {
  beforeEach(() => {
    clearOfflineCache()
    delete process.env.FUSION_OFFLINE_MODE
  })

  it('should return true for all features in online mode', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('generate_204')) return new Response(null, { status: 204 })
      return mockResponse({})
    })

    // Trigger mode detection
    await getOfflineMode()

    expect(isFeatureAvailableInOfflineMode('inference')).toBe(true)
    expect(isFeatureAvailableInOfflineMode('knowledgeBase')).toBe(true)
    expect(isFeatureAvailableInOfflineMode('pluginMarketplace')).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return inference=true even in offline mode', async () => {
    process.env.FUSION_OFFLINE_MODE = '1'

    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('11432')) return mockResponse({ status: 'ok' })
      throw new Error('Unreachable')
    })

    await getOfflineCapabilities()
    expect(isFeatureAvailableInOfflineMode('inference')).toBe(true)
    expect(isFeatureAvailableInOfflineMode('gitRemote')).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── getOfflineFallbackMessage ────────────────────────────────

describe('getOfflineFallbackMessage', () => {
  it('should return a formatted fallback message', () => {
    const msg = getOfflineFallbackMessage('知识库')
    expect(msg).toContain('[离线模式]')
    expect(msg).toContain('知识库')
    expect(msg).toContain('当前不可用')
  })
})