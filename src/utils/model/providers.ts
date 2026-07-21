import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'fusionMlx'

export function getAPIProvider(): APIProvider {
  // Fusion-MLX explicitly disabled via env var
  if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
    // Fall back to cloud providers
    if (false) return 'bedrock'
    if (false) return 'vertex'
    if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) return 'foundry'
    if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) return 'openai'
    return 'firstParty'
  }
  // Fusion-MLX explicitly enabled
  if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) {
    return 'fusionMlx'
  }
  // Explicit cloud provider selection
  if (false) {
    return 'bedrock'
  }
  if (false) {
    return 'vertex'
  }
  if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
    return 'foundry'
  }
  if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) {
    return 'openai'
  }
  // If no cloud API key is configured, default to local fusion-mlx
  if (!process.env.FUSION_API_KEY) {
    return 'fusionMlx'
  }
  return 'firstParty'
}

/**
 * 检查是否正在使用本地 MLX 提供商。
 * 当 fusion-mlx 启用时返回 true。
 */
export function isFusionMlxProvider(): boolean {
  return getAPIProvider() === 'fusionMlx'
}

/**
 * 检查是否应自动使用 fusion-mlx（当没有云 API 密钥时）。
 * 在 CLI 启动时调用，用于自动检测和启用本地推理。
 *
 * 返回 true 表示应该尝试检测并启用 fusion-mlx。
 * 当 FUSION_MLX_DISABLED 设置时返回 false。
 */
export function shouldAutoUseFusionMlx(): boolean {
  if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) return false
  if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) return true
  // 自动模式：没有设置任何云 API 密钥时尝试使用 MLX
  if (isEnvTruthy(process.env.FUSION_MLX_AUTO)) {
    return !process.env.FUSION_API_KEY
  }
  // 检测 ANTHROPIC_BASE_URL 指向本地服务 → 自动启用 MLX 模式
  const baseUrl = process.env.ANTHROPIC_BASE_URL || ''
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('::1')) {
    return true
  }
  // 默认行为：无云 API 密钥时自动使用 MLX（与 getAPIProvider 保持一致）
  if (!process.env.FUSION_API_KEY) {
    return true
  }
  return false
}

/**
 * 检查是否在无云依赖模式下运行。
 * 此时所有云 API 调用（如 OAuth、API key 验证）应被跳过。
 */
export function isCloudFreeMode(): boolean {
  return getAPIProvider() === 'fusionMlx'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if FUSION_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.FUSION_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
