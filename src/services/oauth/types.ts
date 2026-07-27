// OAuth and referral type definitions
// Shapes determined from usage patterns across the codebase

type SubscriptionType = 'pro' | 'max' | 'team' | 'enterprise'

type BillingType =
    | 'stripe_subscription'
    | 'stripe_subscription_contracted'
    | 'apple_subscription'
    | 'google_play_subscription'
    | (string & {})

type RateLimitTier =
    | 'default_claude_max_5x'
    | 'default_claude_max_20x'
    | (string & {})

type ReferralCampaign =
    | 'claude_code_guest_pass'
    | (string & {})

type OAuthProfileResponse = {
    account: {
        uuid: string
        email: string
        display_name?: string
        created_at?: string
        has_claude_max?: boolean
        has_claude_pro?: boolean
    }
    organization: {
        uuid: string
        organization_type:
            | 'claude_max'
            | 'claude_pro'
            | 'claude_enterprise'
            | 'claude_team'
            | (string & {})
        rate_limit_tier?: RateLimitTier
        has_extra_usage_enabled?: boolean
        billing_type?: BillingType
        subscription_created_at?: string
    }
}

type OAuthTokens = {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
    scopes: string[]
    subscriptionType: SubscriptionType | null
    rateLimitTier: RateLimitTier | null
    profile?: OAuthProfileResponse
    tokenAccount?: {
        uuid: string
        emailAddress: string
        organizationUuid?: string
    }
}

type OAuthTokenExchangeResponse = {
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string
    account?: {
        uuid: string
        email_address: string
    }
    organization?: {
        uuid: string
    }
}

type UserRolesResponse = {
    organization_role: string
    workspace_role: string
    organization_name: string
}

type ReferralRedemptionsResponse = {
    redemptions: unknown[]
    limit: number
}

type ReferrerRewardInfo = {
    currency: string
    amount_minor_units: number
}

type ReferralEligibilityResponse = {
    eligible: boolean
    remaining_passes: number
    referrer_reward: ReferrerRewardInfo
    referral_code_details?: {
        referral_link: string
        campaign: string
    }
}

export type {
    SubscriptionType,
    BillingType,
    RateLimitTier,
    ReferralCampaign,
    OAuthProfileResponse,
    OAuthTokens,
    OAuthTokenExchangeResponse,
    UserRolesResponse,
    ReferralRedemptionsResponse,
    ReferrerRewardInfo,
    ReferralEligibilityResponse,
}
