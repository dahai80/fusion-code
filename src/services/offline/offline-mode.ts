/**
 * 本地离线模式
 *
 * 确保 fusion-code 在无网络环境下完全可用。
 * 提供离线模式检测、云功能降级、本地回退策略。
 */

import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

// ─── 离线模式类型 ────────────────────────────────────────────

export type OfflineModeLevel = 'full' | 'partial' | 'none'

export interface OfflineCapabilities {
  /** AI 推理是否可用 */
  inference: boolean
  /** 知识库检索是否可用 */
  knowledgeBase: boolean
  /** 插件市场是否可用 */
  pluginMarketplace: boolean
  /** 模型下载是否可用 */
  modelDownload: boolean
  /** 代码分析是否可用 */
  codeAnalysis: boolean
  /** 安全扫描是否可用 */
  securityScan: boolean
  /** Git 远程操作是否可用 */
  gitRemote: boolean
}

// ─── 离线模式检测 ────────────────────────────────────────────

let _offlineMode: OfflineModeLevel | null = null
let _cachedCapabilities: OfflineCapabilities | null = null

/**
 * 检查网络连通性。
 * 通过尝试连接本地服务来避免网络超时。
 */
async function checkNetworkConnectivity(): Promise<boolean> {
  try {
    // 快速检测：尝试连接一个可靠的端点
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const res = await fetch('https://clients3.google.com/generate_204', {
        method: 'HEAD',
        signal: controller.signal,
      })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return false
  }
}

/**
 * 获取当前离线模式级别。
 *
 * - 'full': 完全离线，无任何网络请求
 * - 'partial': 部分离线，仅本地服务可用
 * - 'none': 在线模式，所有功能可用
 */
export async function getOfflineMode(): Promise<OfflineModeLevel> {
  if (_offlineMode) return _offlineMode

  // 环境变量强制指定
  if (isEnvTruthy(process.env.FUSION_OFFLINE_MODE)) {
    _offlineMode = 'full'
    return _offlineMode
  }

  // 检测网络连通性
  const online = await checkNetworkConnectivity()
  if (!online) {
    // 检测本地服务是否可用
    const mlxAvailable = await checkLocalService('http://127.0.0.1:11434/v1/health')
    _offlineMode = mlxAvailable ? 'partial' : 'full'
    return _offlineMode
  }

  _offlineMode = 'none'
  return _offlineMode
}

/**
 * 检查本地服务是否可用。
 */
async function checkLocalService(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 获取当前离线能力矩阵。
 */
export async function getOfflineCapabilities(): Promise<OfflineCapabilities> {
  if (_cachedCapabilities) return _cachedCapabilities

  const mode = await getOfflineMode()

  if (mode === 'full') {
    _cachedCapabilities = {
      inference: await checkLocalService('http://127.0.0.1:11434/v1/health'),
      knowledgeBase: await checkLocalService('http://127.0.0.1:11435/v1/health'),
      pluginMarketplace: false,
      modelDownload: false,
      codeAnalysis: await checkLocalService('http://127.0.0.1:11438/v1/health'),
      securityScan: await checkLocalService('http://127.0.0.1:11439/v1/health'),
      gitRemote: false,
    }
  } else if (mode === 'partial') {
    _cachedCapabilities = {
      inference: true,
      knowledgeBase: await checkLocalService('http://127.0.0.1:11435/v1/health'),
      pluginMarketplace: false,
      modelDownload: false,
      codeAnalysis: await checkLocalService('http://127.0.0.1:11438/v1/health'),
      securityScan: await checkLocalService('http://127.0.0.1:11439/v1/health'),
      gitRemote: false,
    }
  } else {
    _cachedCapabilities = {
      inference: true,
      knowledgeBase: true,
      pluginMarketplace: true,
      modelDownload: true,
      codeAnalysis: true,
      securityScan: true,
      gitRemote: true,
    }
  }

  return _cachedCapabilities
}

// ─── 离线模式策略 ────────────────────────────────────────────

/**
 * 检查是否应跳过云 API 调用。
 * 在离线模式下，所有云 API 调用应被跳过或降级。
 */
export function shouldSkipCloudApi(): boolean {
  return (
    _offlineMode === 'full' ||
    isEnvTruthy(process.env.FUSION_OFFLINE_MODE) ||
    isEnvTruthy(process.env.FUSION_MLX_ENABLED)
  )
}

/**
 * 获取离线模式下的模型回退策略。
 */
export function getOfflineFallbackModel(): string {
  return process.env.FUSION_MLX_MODEL || 'default'
}

/**
 * 清除离线模式缓存（在网络状态变化时调用）。
 */
export function clearOfflineCache(): void {
  _offlineMode = null
  _cachedCapabilities = null
}

// ─── 启动时离线检测 ──────────────────────────────────────────

/**
 * 在 CLI 启动时执行离线检测。
 * 返回一个状态对象，供 UI 展示。
 */
export async function detectOfflineModeAtStartup(): Promise<{
  mode: OfflineModeLevel
  capabilities: OfflineCapabilities
  message: string
}> {
  const mode = await getOfflineMode()
  const capabilities = await getOfflineCapabilities()

  let message: string
  switch (mode) {
    case 'full':
      message = '🌐 离线模式：无网络连接，仅本地 AI 推理可用'
      break
    case 'partial':
      message = '🌐 部分离线：本地服务可用，云功能受限'
      break
    case 'none':
      message = '🌐 在线模式：所有功能可用'
      break
  }

  logForDebugging(`[Offline] Mode=${mode} inference=${capabilities.inference} kb=${capabilities.knowledgeBase}`)

  return { mode, capabilities, message }
}

// ─── 功能降级 ────────────────────────────────────────────────

/**
 * 离线模式下的功能降级检查。
 * 返回 true 表示该功能在当前模式下可用。
 */
export function isFeatureAvailableInOfflineMode(
  feature: keyof OfflineCapabilities,
): boolean {
  if (_offlineMode === 'none') return true
  if (_cachedCapabilities) {
    return _cachedCapabilities[feature]
  }
  // 默认：AI 推理始终可用（本地 MLX）
  if (feature === 'inference') return true
  return false
}

/**
 * 获取离线模式下的替代提示。
 */
export function getOfflineFallbackMessage(
  feature: string,
): string {
  return `[离线模式] ${feature} 当前不可用。请连接网络或启动本地 Fusion 服务。`
}