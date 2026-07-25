import { logForDebugging } from '../debug.js'
import { getAPIProvider } from './providers.js'

export function isBedrockProvider(): boolean {
    return getAPIProvider() === 'bedrock'
}

export function getBedrockConfig(): {
    region: string
    modelId: string
    profile?: string
} | null {
    if (!isBedrockProvider()) return null
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
    const modelId = process.env.FUSION_MODEL || process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-sonnet-4-20250514'
    const profile = process.env.AWS_PROFILE
    logForDebugging(`[Bedrock] region=${region}, modelId=${modelId}, profile=${profile || '(default)'}`)
    return { region, modelId, profile }
}

export function getBedrockBaseUrl(): string {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
    return `https://bedrock-runtime.${region}.amazonaws.com`
}

export function requiresBedrockAuth(): boolean {
    return isBedrockProvider() && !process.env.AWS_ACCESS_KEY_ID
}
