// log: created for TS2307 fix

import type { OAuthTokens } from '../../services/oauth/types.js'
import type { CodexTokens } from '../../services/oauth/codex-client.js'

export type SecureStorageData = {
    mcpOAuth?: Record<string, {
        serverName: string
        serverUrl: string
        clientId?: string
        clientSecret?: string
        accessToken?: string
        refreshToken?: string
        expiresAt?: number
        scope?: string
        stepUpScope?: string
        discoveryState?: {
            authorizationServerUrl: string
            resourceMetadataUrl: string
            // log: fix TS2339
            authorizationServerMetadata?: unknown
            resourceMetadata?: unknown
        }
    }>
    mcpOAuthClientConfig?: Record<string, unknown>
    // log: fix TS2339
    primaryApiKey?: string
    // log: fix TS2339
    claudeAiOauth?: OAuthTokens
    // log: fix TS2339
    codexOAuth?: CodexTokens
    [key: string]: unknown
}

export interface SecureStorage {
    name: string
    read(): SecureStorageData | null
    readAsync(): Promise<SecureStorageData | null>
    update(data: SecureStorageData): { success: boolean; warning?: string }
    delete(): boolean
}
