import { logEvent } from 'src/services/analytics/index.js'
import { openBrowser } from '../../utils/browser.js'
import { AuthCodeListener } from './auth-code-listener.js'
import * as client from './client.js'
import * as crypto from './crypto.js'
import type {
  OAuthProfileResponse,
  OAuthTokenExchangeResponse,
  OAuthTokens,
  RateLimitTier,
  SubscriptionType,
} from './types.js'

/**
 * OAuth service that handles the OAuth 2.0 authorization code flow with PKCE.
 *
 * Supports two ways to get authorization codes:
 * 1. Automatic: Opens browser, redirects to localhost where we capture the code
 * 2. Manual: User manually copies and pastes the code (used in non-browser environments)
 */
export class OAuthService {
  private codeVerifier: string
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private manualAuthCodeResolver: ((authorizationCode: string) => void) | null =
    null
  // P1-11: CSRF 绑定 state, 手动流程校验。auto flow 在 auth-code-listener.ts:69
  // 存 this.expectedState; 手动流程此前无校验 (params.state 未比对此值 = CSRF)。
  // 这里镜像: 存 + 比对。null = 无进行中 OAuth (不误拒)。
  private expectedState: string | null = null

  constructor() {
    this.codeVerifier = crypto.generateCodeVerifier()
  }

  async startOAuthFlow(
    authURLHandler: (url: string, automaticUrl?: string) => Promise<void>,
    options?: {
      loginWithClaudeAi?: boolean
      inferenceOnly?: boolean
      expiresIn?: number
      orgUUID?: string
      loginHint?: string
      loginMethod?: string
      /**
       * Don't call openBrowser(). Caller takes both URLs via authURLHandler
       * and decides how/where to open them. Used by the SDK control protocol
       * (claude_authenticate) where the SDK client owns the user's display,
       * not this process.
       */
      skipBrowserOpen?: boolean
    },
  ): Promise<OAuthTokens> {
    // Create OAuth callback listener and start it
    this.authCodeListener = new AuthCodeListener()
    this.port = await this.authCodeListener.start()

    // Generate PKCE values and state
    const codeChallenge = crypto.generateCodeChallenge(this.codeVerifier)
    const state = crypto.generateState()

    // Build auth URLs for both automatic and manual flows
    const opts = {
      codeChallenge,
      state,
      port: this.port,
      loginWithClaudeAi: options?.loginWithClaudeAi,
      inferenceOnly: options?.inferenceOnly,
      orgUUID: options?.orgUUID,
      loginHint: options?.loginHint,
      loginMethod: options?.loginMethod,
    }
    const manualFlowUrl = client.buildAuthUrl({ ...opts, isManual: true })
    const automaticFlowUrl = client.buildAuthUrl({ ...opts, isManual: false })

    // Wait for either automatic or manual auth code
    const authorizationCode = await this.waitForAuthorizationCode(
      state,
      async () => {
        if (options?.skipBrowserOpen) {
          // Hand both URLs to the caller. The automatic one still works
          // if the caller opens it on the same host (localhost listener
          // is running); the manual one works from anywhere.
          await authURLHandler(manualFlowUrl, automaticFlowUrl)
        } else {
          await authURLHandler(manualFlowUrl) // Show manual option to user
          await openBrowser(automaticFlowUrl) // Try automatic flow
        }
      },
    )

    // Check if the automatic flow is still active (has a pending response)
    const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false
    logEvent('tengu_oauth_auth_code_received', { automatic: isAutomaticFlow })

    try {
      // Exchange authorization code for tokens
      const tokenResponse = await client.exchangeCodeForTokens(
        authorizationCode,
        state,
        this.codeVerifier,
        this.port!,
        !isAutomaticFlow, // Pass isManual=true if it's NOT automatic flow
        options?.expiresIn,
      )

      // Fetch profile info (subscription type and rate limit tier) for the
      // returned OAuthTokens. Logout and account storage are handled by the
      // caller (installOAuthTokens in auth.ts).
      const profileInfo = await client.fetchProfileInfo(
        tokenResponse.access_token,
      )

      // Handle success redirect for automatic flow
      if (isAutomaticFlow) {
        const scopes = client.parseScopes(tokenResponse.scope)
        this.authCodeListener?.handleSuccessRedirect(scopes)
      }

      return this.formatTokens(
        tokenResponse,
        profileInfo.subscriptionType,
        profileInfo.rateLimitTier,
        profileInfo.rawProfile,
      )
    } catch (error) {
      // If we have a pending response, send an error redirect before closing
      if (isAutomaticFlow) {
        this.authCodeListener?.handleErrorRedirect()
      }
      throw error
    } finally {
      // Always cleanup
      this.authCodeListener?.close()
    }
  }

  private async waitForAuthorizationCode(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Set up manual auth code resolver
      this.manualAuthCodeResolver = resolve
      // P1-11: 存 expected state 供手动流程校验 (CSRF 绑定)。
      this.expectedState = state

      // Start automatic flow
      this.authCodeListener
        ?.waitForAuthorization(state, onReady)
        .then(authorizationCode => {
          this.manualAuthCodeResolver = null
          this.expectedState = null
          resolve(authorizationCode)
        })
        .catch(error => {
          this.manualAuthCodeResolver = null
          this.expectedState = null
          reject(error)
        })
    })
  }

  // Handle manual flow callback when user pastes the auth code
  handleManualAuthCodeInput(params: {
    authorizationCode: string
    state: string
  }): void {
    if (!this.manualAuthCodeResolver) {
      return
    }
    // P1-11: CSRF state 绑定 — 镜像 auth-code-listener.ts:164。state 不匹配 =
    // 钓鱼/CSRF (攻击者诱导受害者粘贴攻击者 code)。不 resolve, 不交换 token, fail-visible。
    if (
      this.expectedState == null ||
      params.state !== this.expectedState
    ) {
      logEvent('tengu_oauth_manual_state_mismatch', {})
      this.manualAuthCodeResolver = null
      this.expectedState = null
      this.authCodeListener?.close()
      throw new Error(
        'Invalid state parameter — manual OAuth flow rejected (CSRF guard)',
      )
    }
    this.manualAuthCodeResolver(params.authorizationCode)
    this.manualAuthCodeResolver = null
    this.expectedState = null
    // Close the auth code listener since manual input was used
    this.authCodeListener?.close()
  }

  private formatTokens(
    response: OAuthTokenExchangeResponse,
    subscriptionType: SubscriptionType | null,
    rateLimitTier: RateLimitTier | null,
    profile?: OAuthProfileResponse,
  ): OAuthTokens {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: client.parseScopes(response.scope),
      subscriptionType,
      rateLimitTier,
      profile,
      tokenAccount: response.account
        ? {
            uuid: response.account.uuid,
            emailAddress: response.account.email_address,
            organizationUuid: response.organization?.uuid,
          }
        : undefined,
    }
  }

  // Clean up any resources (like the local server)
  cleanup(): void {
    this.authCodeListener?.close()
    this.manualAuthCodeResolver = null
  }
}
