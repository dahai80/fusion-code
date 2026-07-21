/**
 * fusion-kb-client 测试
 *
 * 验证：
 * 1. checkKbHealth — 健康检查
 * 2. listCollections — 集合列表
 * 3. searchKb — 知识库搜索
 * 4. enhanceWithCodeContext — 代码上下文增强
 * 5. indexDocument — 文档索引
 * 6. indexDocuments — 批量索引
 * 7. deleteDocument — 文档删除
 */
import { describe, it, expect, beforeEach, spyOn } from 'bun:test'
import {
  checkKbHealth,
  listCollections,
  searchKb,
  enhanceWithCodeContext,
  indexDocument,
  indexDocuments,
  deleteDocument,
} from '../../../src/services/kb/fusion-kb-client.js'

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── checkKbHealth ───────────────────────────────────────────

describe('checkKbHealth', () => {
  beforeEach(() => {
    delete process.env.FUSION_KB_BASE_URL
  })

  it('should return true when service is healthy', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/health')) {
        return mockResponse({ status: 'ok' })
      }
      return mockResponse({})
    })

    const result = await checkKbHealth()
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false on non-ok response', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/health')) {
        return new Response(null, { status: 503 })
      }
      return mockResponse({})
    })

    const result = await checkKbHealth()
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })

  it('should return false on network error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Connection refused')
    })

    const result = await checkKbHealth()
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── listCollections ──────────────────────────────────────────

describe('listCollections', () => {
  it('should return collection list', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/collections')) {
        return mockResponse({
          collections: [
            { id: 'code', name: 'Code', description: 'Code snippets', document_count: 100, embedding_model: 'default' },
            { id: 'docs', name: 'Docs', description: 'Documentation', document_count: 50, embedding_model: 'default' },
          ],
        })
      }
      return mockResponse({})
    })

    const collections = await listCollections()
    expect(collections).toHaveLength(2)
    expect(collections[0].id).toBe('code')
    expect(collections[0].document_count).toBe(100)
    mockFetch.mockRestore()
  })

  it('should return empty array on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const collections = await listCollections()
    expect(collections).toEqual([])
    mockFetch.mockRestore()
  })
})

// ─── searchKb ─────────────────────────────────────────────────

describe('searchKb', () => {
  it('should return search results with default collection', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/collections/default/search')) {
        return mockResponse({
          results: [{ id: 'd1', content: 'Result 1', metadata: { path: '/a.ts' }, score: 0.9 }],
        })
      }
      return mockResponse({})
    })

    const results = await searchKb({ query: 'test query' })
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('Result 1')
    expect(results[0].score).toBe(0.9)
    mockFetch.mockRestore()
  })

  it('should search in specific collection', async () => {
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calledUrl = String(url)
      return mockResponse({ results: [] })
    })

    await searchKb({ query: 'test', collection: 'code', top_k: 10, min_score: 0.5 })
    expect(calledUrl).toContain('/collections/code/search')
    mockFetch.mockRestore()
  })

  it('should send filter in request body', async () => {
    let requestBody = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/search')) {
        requestBody = (init as RequestInit).body as string
        return mockResponse({ results: [] })
      }
      return mockResponse({})
    })

    await searchKb({ query: 'test', collection: 'code', filter: { project: 'fusion' } })
    const body = JSON.parse(requestBody)
    expect(body.filter).toEqual({ project: 'fusion' })
    expect(body.top_k).toBe(5)
    mockFetch.mockRestore()
  })

  it('should return empty array on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const results = await searchKb({ query: 'test' })
    expect(results).toEqual([])
    mockFetch.mockRestore()
  })
})

// ─── enhanceWithCodeContext ───────────────────────────────────

describe('enhanceWithCodeContext', () => {
  it('should return formatted context string', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/search')) {
        return mockResponse({
          results: [
            { id: 'd1', content: 'function hello() { return 1; }', metadata: { file_path: '/src/main.ts' }, score: 0.95 },
            { id: 'd2', content: 'function world() { return 2; }', metadata: { file_path: '/src/utils.ts' }, score: 0.85 },
          ],
        })
      }
      return mockResponse({})
    })

    const context = await enhanceWithCodeContext('hello world', '/project', 2)
    expect(context).toContain('<fusion_kb_context>')
    expect(context).toContain('function hello()')
    expect(context).toContain('/src/main.ts')
    expect(context).toContain('function world()')
    expect(context).toContain('95%') // score 0.95
    expect(context).toContain('85%') // score 0.85
    mockFetch.mockRestore()
  })

  it('should return empty string when no results', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/search')) {
        return mockResponse({ results: [] })
      }
      return mockResponse({})
    })

    const context = await enhanceWithCodeContext('unknown query')
    expect(context).toBe('')
    mockFetch.mockRestore()
  })

  it('should return empty string on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const context = await enhanceWithCodeContext('test')
    expect(context).toBe('')
    mockFetch.mockRestore()
  })
})

// ─── indexDocument ────────────────────────────────────────────

describe('indexDocument', () => {
  it('should return true on success', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/documents')) {
        const body = JSON.parse((init as RequestInit).body as string)
        expect(body.content).toBe('test content')
        expect(body.metadata.path).toBe('/test.ts')
        return new Response(null, { status: 201 })
      }
      return mockResponse({})
    })

    const result = await indexDocument('test content', { path: '/test.ts' }, 'code')
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should use default collection when not specified', async () => {
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calledUrl = String(url)
      return new Response(null, { status: 201 })
    })

    await indexDocument('content', {})
    expect(calledUrl).toContain('/collections/default/documents')
    mockFetch.mockRestore()
  })

  it('should return false on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 500 })
    })

    const result = await indexDocument('content', {})
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── indexDocuments ───────────────────────────────────────────

describe('indexDocuments', () => {
  it('should batch index documents', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/batch')) {
        const body = JSON.parse((init as RequestInit).body as string)
        expect(body.documents).toHaveLength(2)
        expect(body.documents[0].content).toBe('doc1')
        return new Response(null, { status: 201 })
      }
      return mockResponse({})
    })

    const result = await indexDocuments([
      { content: 'doc1', metadata: { id: 1 } },
      { content: 'doc2', metadata: { id: 2 } },
    ], 'code')
    expect(result).toBe(true)
    mockFetch.mockRestore()
  })

  it('should return false on error', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Error')
    })

    const result = await indexDocuments([{ content: 'doc', metadata: {} }])
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})

// ─── deleteDocument ───────────────────────────────────────────

describe('deleteDocument', () => {
  it('should return true on success', async () => {
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calledUrl = String(url)
      expect((init as RequestInit).method).toBe('DELETE')
      return new Response(null, { status: 200 })
    })

    const result = await deleteDocument('doc_123', 'code')
    expect(result).toBe(true)
    expect(calledUrl).toContain('/collections/code/documents/doc_123')
    mockFetch.mockRestore()
  })

  it('should use default collection', async () => {
    let calledUrl = ''
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calledUrl = String(url)
      return new Response(null, { status: 200 })
    })

    await deleteDocument('doc_123')
    expect(calledUrl).toContain('/collections/default/documents/doc_123')
    mockFetch.mockRestore()
  })

  it('should return false on failure', async () => {
    const mockFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 404 })
    })

    const result = await deleteDocument('unknown')
    expect(result).toBe(false)
    mockFetch.mockRestore()
  })
})