/**
 * Fusion-KB 知识库客户端
 *
 * 将 fusion-code 与 fusion-kb 知识库系统集成，
 * 提供 RAG 检索、文档索引、代码上下文增强能力。
 */

import { logForDebugging } from '../../utils/debug.js'

const DEFAULT_KB_BASE_URL = 'http://127.0.0.1:11435'

function getKbBaseUrl(): string {
  return process.env.FUSION_KB_BASE_URL || DEFAULT_KB_BASE_URL
}

// ─── Types ────────────────────────────────────────────────────

export interface KBDocument {
  id: string
  content: string
  metadata: Record<string, unknown>
  collection: string
  created_at: string
}

export interface KBSearchQuery {
  query: string
  top_k?: number
  collection?: string
  filter?: Record<string, unknown>
  min_score?: number
}

export interface KBSearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

export interface KBCollection {
  id: string
  name: string
  description: string
  document_count: number
  embedding_model: string
}

// ─── Health Check ─────────────────────────────────────────────

export async function checkKbHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getKbBaseUrl()}/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Collections ──────────────────────────────────────────────

export async function listCollections(): Promise<KBCollection[]> {
  try {
    const res = await fetch(`${getKbBaseUrl()}/v1/collections`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { collections: KBCollection[] }
    return data.collections || []
  } catch (error) {
    logForDebugging(`[Fusion-KB] listCollections error: ${(error as Error).message}`)
    return []
  }
}

// ─── Search ───────────────────────────────────────────────────

/**
 * 在知识库中搜索相关内容。
 * 支持按集合、分数阈值、元数据过滤。
 */
export async function searchKb(
  query: KBSearchQuery,
): Promise<KBSearchResult[]> {
  try {
    const res = await fetch(
      `${getKbBaseUrl()}/v1/collections/${query.collection ?? 'default'}/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.query,
          top_k: query.top_k ?? 5,
          filter: query.filter,
          min_score: query.min_score ?? 0.0,
        }),
        signal: AbortSignal.timeout(10000),
      },
    )

    if (!res.ok) {
      logForDebugging(`[Fusion-KB] Search failed: ${res.status} ${res.statusText}`)
      return []
    }

    const data = (await res.json()) as { results: KBSearchResult[] }
    return data.results || []
  } catch (error) {
    logForDebugging(`[Fusion-KB] Search error: ${(error as Error).message}`)
    return []
  }
}

/**
 * 为代码查询进行 RAG 上下文增强。
 * 搜索知识库中与当前查询相关的代码片段和文档。
 */
export async function enhanceWithCodeContext(
  query: string,
  projectPath?: string,
  topK: number = 3,
): Promise<string> {
  const results = await searchKb({
    query,
    top_k: topK,
    collection: 'code',
    filter: projectPath ? { path: projectPath } : undefined,
    min_score: 0.3,
  })

  if (results.length === 0) return ''

  const contextParts = results.map(
    (r, i) =>
      `[参考 ${i + 1}] (相关度: ${(r.score * 100).toFixed(0)}%)\n${
        r.metadata?.file_path ? `文件: ${r.metadata.file_path}\n` : ''
      }${r.content.slice(0, 2000)}`,
  )

  return `\n\n<fusion_kb_context>\n${contextParts.join('\n\n---\n\n')}\n</fusion_kb_context>`
}

// ─── Index ────────────────────────────────────────────────────

/**
 * 将文档索引到知识库中。
 */
export async function indexDocument(
  content: string,
  metadata: Record<string, unknown>,
  collection: string = 'default',
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getKbBaseUrl()}/v1/collections/${collection}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, metadata }),
        signal: AbortSignal.timeout(10000),
      },
    )
    return res.ok
  } catch (error) {
    logForDebugging(`[Fusion-KB] Index error: ${(error as Error).message}`)
    return false
  }
}

/**
 * 批量索引文档。
 */
export async function indexDocuments(
  documents: Array<{ content: string; metadata: Record<string, unknown> }>,
  collection: string = 'default',
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getKbBaseUrl()}/v1/collections/${collection}/documents/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
        signal: AbortSignal.timeout(30000),
      },
    )
    return res.ok
  } catch (error) {
    logForDebugging(`[Fusion-KB] Batch index error: ${(error as Error).message}`)
    return false
  }
}

// ─── Delete ──────────────────────────────────────────────────

export async function deleteDocument(
  docId: string,
  collection: string = 'default',
): Promise<boolean> {
  try {
    const res = await fetch(
      `${getKbBaseUrl()}/v1/collections/${collection}/documents/${docId}`,
      { method: 'DELETE', signal: AbortSignal.timeout(5000) },
    )
    return res.ok
  } catch (error) {
    logForDebugging(`[Fusion-KB] Delete error: ${(error as Error).message}`)
    return false
  }
}