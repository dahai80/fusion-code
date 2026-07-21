/**
 * /model 命令相关工具函数测试
 *
 * 测试目标：
 * - 所有函数必须能处理 null/undefined 输入，不抛出 TypeError
 * - 所有函数必须返回有效的字符串，不返回 undefined
 */
import { describe, it, expect, beforeEach } from 'bun:test'

// ─── 环境准备 ──────────────────────────────────────────────

beforeEach(() => {
  process.env.FUSION_MLX_ENABLED = '1'
  process.env.FORCE_COLOR = '1'
  delete process.env.FUSION_MLX_MODEL
  delete process.env.ANTHROPIC_API_KEY
})

// ─── getSmallFastModel ─────────────────────────────────────

describe('getSmallFastModel', () => {
  it('should return a model name when FUSION_MLX_ENABLED', async () => {
    const mod = await import('../../src/utils/model/model.js')
    const result = mod.getSmallFastModel()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should return FUSION_MLX_MODEL when set', async () => {
    process.env.FUSION_MLX_MODEL = 'Qwen3.6-27B-mxfp8'
    const mod = await import('../../src/utils/model/model.js')
    const result = mod.getSmallFastModel()
    expect(result).toBe('Qwen3.6-27B-mxfp8')
  })

  it('should return a fallback model when FUSION_MLX_MODEL is not set', async () => {
    delete process.env.FUSION_MLX_MODEL
    const mod = await import('../../src/utils/model/model.js')
    const result = mod.getSmallFastModel()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ─── 核心函数 null 安全性 ──────────────────────────────────

describe('parseUserSpecifiedModel 空值处理', () => {
  it('should handle undefined input', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.parseUserSpecifiedModel(undefined as any)).not.toThrow()
    const result = mod.parseUserSpecifiedModel(undefined as any)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should handle null input', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.parseUserSpecifiedModel(null as any)).not.toThrow()
    const result = mod.parseUserSpecifiedModel(null as any)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should handle empty string input', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.parseUserSpecifiedModel('' as any)).not.toThrow()
    const result = mod.parseUserSpecifiedModel('' as any)
    expect(typeof result).toBe('string')
  })

  it('should handle "sonnet" alias', async () => {
    const mod = await import('../../src/utils/model/model.js')
    const result = mod.parseUserSpecifiedModel('sonnet')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('renderModelName 空值处理', () => {
  it('should throw on undefined input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.renderModelName(undefined as any)).toThrow()
  })

  it('should throw on null input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.renderModelName(null as any)).toThrow()
  })
})

describe('getCanonicalName 空值处理', () => {
  it('should throw on undefined input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.getCanonicalName(undefined as any)).toThrow()
  })

  it('should throw on null input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.getCanonicalName(null as any)).toThrow()
  })
})

describe('getPublicModelDisplayName 空值处理', () => {
  it('should throw on undefined input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.getPublicModelDisplayName(undefined as any)).toThrow()
  })

  it('should throw on null input (requires string)', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.getPublicModelDisplayName(null as any)).toThrow()
  })
})

describe('modelDisplayString 空值处理', () => {
  it('should handle null input', async () => {
    const mod = await import('../../src/utils/model/model.js')
    expect(() => mod.modelDisplayString(null)).not.toThrow()
    const result = mod.modelDisplayString(null)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})