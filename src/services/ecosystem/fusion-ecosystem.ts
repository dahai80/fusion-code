/**
 * Fusion 生态集成服务
 *
 * 将 fusion-code 与 Fusion 全生态深度集成：
 * - fusion-kb: 知识库 RAG 检索
 * - fusion-plugins-ecosystem: 插件注册中心
 * - fusion-model-hub: 模型管理
 * - fusion-cli: 统一入口
 * - fusion-desk: 桌面集成
 * - fusion-code-modelization: 代码建模
 * - fusion-security: 安全扫描
 */

import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// ─── Configuration ────────────────────────────────────────────

const FUSION_KB_BASE_URL = 'http://127.0.0.1:11435'
const FUSION_PLUGINS_BASE_URL = 'http://127.0.0.1:11436'
const FUSION_MODEL_HUB_BASE_URL = 'http://127.0.0.1:11437'
const FUSION_CODE_MODELIZATION_BASE_URL = 'http://127.0.0.1:11438'
const FUSION_SECURITY_BASE_URL = 'http://127.0.0.1:11439'

function getKbBaseUrl(): string {
  return process.env.FUSION_KB_BASE_URL || FUSION_KB_BASE_URL
}

function getPluginsBaseUrl(): string {
  return process.env.FUSION_PLUGINS_BASE_URL || FUSION_PLUGINS_BASE_URL
}

function getModelHubBaseUrl(): string {
  return process.env.FUSION_MODEL_HUB_BASE_URL || FUSION_MODEL_HUB_BASE_URL
}

function getCodeModelizationBaseUrl(): string {
  return (
    process.env.FUSION_CODE_MODELIZATION_BASE_URL ||
    FUSION_CODE_MODELIZATION_BASE_URL
  )
}

function getSecurityBaseUrl(): string {
  return process.env.FUSION_SECURITY_BASE_URL || FUSION_SECURITY_BASE_URL
}

// ─── Service Health ───────────────────────────────────────────

export interface FusionServiceStatus {
  kb: boolean
  plugins: boolean
  modelHub: boolean
  codeModelization: boolean
  security: boolean
}

/**
 * 检测所有 Fusion 生态服务的可用性。
 */
export async function checkFusionServices(): Promise<FusionServiceStatus> {
  const timeout = 2000

  const check = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const [kb, plugins, modelHub, codeModelization, security] =
    await Promise.all([
      check(`${getKbBaseUrl()}/v1/health`).catch(() => false),
      check(`${getPluginsBaseUrl()}/v1/health`).catch(() => false),
      check(`${getModelHubBaseUrl()}/v1/health`).catch(() => false),
      check(`${getCodeModelizationBaseUrl()}/v1/health`).catch(() => false),
      check(`${getSecurityBaseUrl()}/v1/health`).catch(() => false),
    ])

  return { kb, plugins, modelHub, codeModelization, security }
}

// ─── Fusion-KB 知识库集成 ────────────────────────────────────

export interface KBSearchResult {
  id: string
  content: string
  metadata: Record<string, unknown>
  score: number
}

/**
 * 在 fusion-kb 中搜索相关内容。
 * 用于代码上下文增强和 RAG 检索。
 */
export async function searchKnowledgeBase(
  query: string,
  options?: {
    topK?: number
    collection?: string
    filter?: Record<string, unknown>
  },
): Promise<KBSearchResult[]> {
  try {
    const response = await fetch(
      `${getKbBaseUrl()}/v1/collections/${options?.collection ?? 'default'}/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          top_k: options?.topK ?? 5,
          filter: options?.filter,
        }),
        signal: AbortSignal.timeout(10000),
      },
    )

    if (!response.ok) {
      logForDebugging(
        `[Fusion-KB] Search failed: ${response.status} ${response.statusText}`,
      )
      return []
    }

    const data = (await response.json()) as {
      results: KBSearchResult[]
    }
    return data.results || []
  } catch (error) {
    logForDebugging(
      `[Fusion-KB] Search error: ${(error as Error).message}`,
    )
    return []
  }
}

/**
 * 将文档索引到 fusion-kb。
 * 用于代码片段、文档等的知识库存储。
 */
export async function indexToKnowledgeBase(
  content: string,
  metadata: Record<string, unknown>,
  collection?: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${getKbBaseUrl()}/v1/collections/${collection ?? 'default'}/documents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          metadata,
        }),
        signal: AbortSignal.timeout(10000),
      },
    )

    return response.ok
  } catch (error) {
    logForDebugging(
      `[Fusion-KB] Index error: ${(error as Error).message}`,
    )
    return false
  }
}

// ─── Fusion-Plugins-Ecosystem 插件集成 ────────────────────────

export interface FusionPluginInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  type: 'skill' | 'tool' | 'mcp' | 'hook'
}

/**
 * 获取已注册的 Fusion 插件列表。
 */
export async function getFusionPlugins(): Promise<FusionPluginInfo[]> {
  try {
    const response = await fetch(
      `${getPluginsBaseUrl()}/v1/plugins`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) return []

    const data = (await response.json()) as { plugins: FusionPluginInfo[] }
    return data.plugins || []
  } catch (error) {
    logForDebugging(
      `[Fusion-Plugins] List error: ${(error as Error).message}`,
    )
    return []
  }
}

/**
 * 启用/禁用 Fusion 插件。
 */
export async function setFusionPluginState(
  pluginId: string,
  enabled: boolean,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${getPluginsBaseUrl()}/v1/plugins/${pluginId}/state`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
        signal: AbortSignal.timeout(5000),
      },
    )
    return response.ok
  } catch (error) {
    logForDebugging(
      `[Fusion-Plugins] State change error: ${(error as Error).message}`,
    )
    return false
  }
}

// ─── Fusion-Model-Hub 模型管理集成 ────────────────────────────

export interface FusionModelInfo {
  id: string
  name: string
  path: string
  format: string
  size: string
  quantization: string
  active: boolean
}

/**
 * 获取 fusion-model-hub 中的可用模型列表。
 */
export async function getFusionModels(): Promise<FusionModelInfo[]> {
  try {
    const response = await fetch(
      `${getModelHubBaseUrl()}/v1/models`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) return []

    const data = (await response.json()) as { models: FusionModelInfo[] }
    return data.models || []
  } catch (error) {
    logForDebugging(
      `[Fusion-Model-Hub] List error: ${(error as Error).message}`,
    )
    return []
  }
}

/**
 * 激活指定模型。
 */
export async function activateFusionModel(
  modelId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${getModelHubBaseUrl()}/v1/models/${modelId}/activate`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      },
    )
    return response.ok
  } catch (error) {
    logForDebugging(
      `[Fusion-Model-Hub] Activate error: ${(error as Error).message}`,
    )
    return false
  }
}

// ─── Fusion-Code-Modelization 代码建模集成 ────────────────────

export interface CodeAnalysisResult {
  summary: string
  dependencies: Array<{ source: string; target: string; type: string }>
  issues: Array<{
    severity: 'high' | 'medium' | 'low'
    type: string
    description: string
    location: string
  }>
  metrics: {
    total_files: number
    total_lines: number
    complexity: number
  }
}

/**
 * 调用 fusion-code-modelization 分析代码库。
 */
export async function analyzeCodebase(
  path: string,
): Promise<CodeAnalysisResult | null> {
  try {
    const response = await fetch(
      `${getCodeModelizationBaseUrl()}/v1/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
        signal: AbortSignal.timeout(120000),
      },
    )

    if (!response.ok) return null

    return (await response.json()) as CodeAnalysisResult
  } catch (error) {
    logForDebugging(
      `[Fusion-Code-Modelization] Analyze error: ${(error as Error).message}`,
    )
    return null
  }
}

// ─── Fusion-Security 安全扫描集成 ─────────────────────────────

export interface SecurityScanResult {
  summary: string
  vulnerabilities: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low'
    type: string
    description: string
    file: string
    line: number
    recommendation: string
  }>
}

/**
 * 调用 fusion-security 进行安全扫描。
 */
export async function scanCodeSecurity(
  path: string,
): Promise<SecurityScanResult | null> {
  try {
    const response = await fetch(
      `${getSecurityBaseUrl()}/v1/scan`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
        signal: AbortSignal.timeout(120000),
      },
    )

    if (!response.ok) return null

    return (await response.json()) as SecurityScanResult
  } catch (error) {
    logForDebugging(
      `[Fusion-Security] Scan error: ${(error as Error).message}`,
    )
    return null
  }
}

// ─── 生态联动状态 ─────────────────────────────────────────────

/**
 * 获取 Fusion 生态的集成状态摘要。
 * 用于在 CLI 中展示生态联动信息。
 */
export async function getEcosystemStatus(): Promise<{
  enabled: boolean
  services: FusionServiceStatus
  plugins: FusionPluginInfo[]
  models: FusionModelInfo[]
}> {
  const [services, plugins, models] = await Promise.all([
    checkFusionServices(),
    getFusionPlugins().catch(() => [] as FusionPluginInfo[]),
    getFusionModels().catch(() => [] as FusionModelInfo[]),
  ])

  return {
    enabled: true,
    services,
    plugins,
    models,
  }
}

/**
 * 检查是否已启用 Fusion 生态集成。
 */
export function isFusionEcosystemEnabled(): boolean {
  return (
    isEnvTruthy(process.env.FUSION_ECOSYSTEM_ENABLED) ||
    !isEnvTruthy(process.env.FUSION_ECOSYSTEM_DISABLED)
  )
}

/**
 * 获取代码上下文增强的 RAG 结果。
 * 在查询时调用，用于增强 AI 对项目代码的理解。
 */
export async function enhanceContextWithRag(
  query: string,
  projectPath?: string,
): Promise<string> {
  if (!isFusionEcosystemEnabled()) return ''

  try {
    const results = await searchKnowledgeBase(query, {
      topK: 3,
      filter: projectPath ? { path: projectPath } : undefined,
    })

    if (results.length === 0) return ''

    const context = results
      .map(
        (r, i) =>
          `[参考 ${i + 1}] (相关度: ${(r.score * 100).toFixed(0)}%)\n${r.content}`,
      )
      .join('\n\n')

    return `\n\n<fusion_kb_context>\n${context}\n</fusion_kb_context>`
  } catch {
    return ''
  }
}