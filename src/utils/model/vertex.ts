import { logForDebugging } from '../debug.js'
import { getAPIProvider } from './providers.js'

export function isVertexProvider(): boolean {
    return getAPIProvider() === 'vertex'
}

export function getVertexConfig(): {
    projectId: string
    region: string
    modelId: string
} | null {
    if (!isVertexProvider()) return null
    const projectId = process.env.CLOUD_ML_REGION
        ? process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || ''
        : process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || ''
    const region = process.env.CLOUD_ML_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-east5'
    const modelId = process.env.FUSION_MODEL || process.env.VERTEX_MODEL || 'claude-sonnet-4@20250514'
    if (!projectId) {
        logForDebugging('[Vertex] WARNING: No Google Cloud project ID configured. Set GOOGLE_CLOUD_PROJECT.')
    }
    logForDebugging(`[Vertex] project=${projectId}, region=${region}, modelId=${modelId}`)
    return { projectId, region, modelId }
}

export function getVertexBaseUrl(): string {
    const region = process.env.CLOUD_ML_REGION || process.env.GOOGLE_CLOUD_REGION || 'us-east5'
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'PLACEHOLDER'
    return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models`
}

export function requiresVertexAuth(): boolean {
    return isVertexProvider() && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT
}
