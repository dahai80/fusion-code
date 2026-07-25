import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider =
  | 'firstParty'
  | 'foundry'
  | 'openai'
  | 'fusionMlx'

export function getAPIProvider(): APIProvider {
    if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) {
        if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) return 'foundry'
        if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) return 'openai'
        return 'firstParty'
    }
    if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) {
        return 'fusionMlx'
    }
    if (isEnvTruthy(process.env.FUSION_CODE_USE_FOUNDRY)) {
        return 'foundry'
    }
    if (isEnvTruthy(process.env.FUSION_CODE_USE_OPENAI)) {
        return 'openai'
    }
    if (!process.env.FUSION_API_KEY) {
        return 'fusionMlx'
    }
    return 'firstParty'
}

export function isFusionMlxProvider(): boolean {
    return getAPIProvider() === 'fusionMlx'
}

export function shouldAutoUseFusionMlx(): boolean {
    if (isEnvTruthy(process.env.FUSION_MLX_DISABLED)) return false
    if (isEnvTruthy(process.env.FUSION_MLX_ENABLED)) return true
    if (isEnvTruthy(process.env.FUSION_MLX_AUTO)) {
        return !process.env.FUSION_API_KEY
    }
    const baseUrl = process.env.FUSION_BASE_URL || process.env.ANTHROPIC_BASE_URL || ''
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('::1')) {
        return true
    }
    if (!process.env.FUSION_API_KEY) {
        return true
    }
    return false
}

export function isCloudFreeMode(): boolean {
    return getAPIProvider() === 'fusionMlx'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
    return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

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
