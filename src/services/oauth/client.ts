// OAuth client for handling authentication flows with Claude services
import axios from "axios";
import {
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	logEvent,
} from "src/services/analytics/index.js";
import { CLAUDE_AI_INFERENCE_SCOPE } from "../../constants/oauth.js";
import {
	getClaudeAIOAuthTokens,
	hasProfileScope,
	isClaudeAISubscriber,
} from "../../utils/auth.js";
import type { AccountInfo } from "../../utils/config.js";
import { getGlobalConfig, saveGlobalConfig } from "../../utils/config.js";
import { logForDebugging } from "../../utils/debug.js";
import { getOauthProfileFromOauthToken } from "./getOauthProfile.js";
import type {
	BillingType,
	OAuthProfileResponse,
	OAuthTokenExchangeResponse,
	OAuthTokens,
	RateLimitTier,
	SubscriptionType,
	UserRolesResponse,
} from "./types.js";

/**
 * Check if the user has Claude.ai authentication scope
 * @private Only call this if you're OAuth / auth related code!
 */
export function shouldUseClaudeAIAuth(scopes: string[] | undefined): boolean {
	return Boolean(scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE));
}

export function parseScopes(scopeString?: string): string[] {
	return scopeString?.split(" ").filter(Boolean) ?? [];
}

export function isOAuthTokenExpired(expiresAt: number | null): boolean {
	if (expiresAt === null) {
		return false;
	}

	const bufferTime = 5 * 60 * 1000;
	const now = Date.now();
	const expiresWithBuffer = now + bufferTime;
	return expiresWithBuffer >= expiresAt;
}

export async function fetchProfileInfo(accessToken: string): Promise<{
	subscriptionType: SubscriptionType | null;
	displayName?: string;
	rateLimitTier: RateLimitTier | null;
	hasExtraUsageEnabled: boolean | null;
	billingType: BillingType | null;
	accountCreatedAt?: string;
	subscriptionCreatedAt?: string;
	rawProfile?: OAuthProfileResponse;
}> {
	const profile = await getOauthProfileFromOauthToken(accessToken);
	const orgType = profile?.organization?.organization_type;

	// Reuse the logic from fetchSubscriptionType
	let subscriptionType: SubscriptionType | null = null;
	switch (orgType) {
		case "claude_max":
			subscriptionType = "max";
			break;
		case "claude_pro":
			subscriptionType = "pro";
			break;
		case "claude_enterprise":
			subscriptionType = "enterprise";
			break;
		case "claude_team":
			subscriptionType = "team";
			break;
		default:
			// Return null for unknown organization types
			subscriptionType = null;
			break;
	}

	const result: {
		subscriptionType: SubscriptionType | null;
		displayName?: string;
		rateLimitTier: RateLimitTier | null;
		hasExtraUsageEnabled: boolean | null;
		billingType: BillingType | null;
		accountCreatedAt?: string;
		subscriptionCreatedAt?: string;
	} = {
		subscriptionType,
		rateLimitTier: profile?.organization?.rate_limit_tier ?? null,
		hasExtraUsageEnabled:
			profile?.organization?.has_extra_usage_enabled ?? null,
		billingType: profile?.organization?.billing_type ?? null,
	};

	if (profile?.account?.display_name) {
		result.displayName = profile.account.display_name;
	}

	if (profile?.account?.created_at) {
		result.accountCreatedAt = profile.account.created_at;
	}

	if (profile?.organization?.subscription_created_at) {
		result.subscriptionCreatedAt = profile.organization.subscription_created_at;
	}

	logEvent("tengu_oauth_profile_fetch_success", {});

	return { ...result, rawProfile: profile };
}

/**
 * Gets the organization UUID from the OAuth access token
 * @returns The organization UUID or null if not authenticated
 */
export async function getOrganizationUUID(): Promise<string | null> {
	// Check global config first to avoid unnecessary API call
	const globalConfig = getGlobalConfig();
	const orgUUID = globalConfig.oauthAccount?.organizationUuid;
	if (orgUUID) {
		return orgUUID;
	}

	// Fall back to fetching from profile (requires user:profile scope)
	const accessToken = getClaudeAIOAuthTokens()?.accessToken;
	if (accessToken === undefined || !hasProfileScope()) {
		return null;
	}
	const profile = await getOauthProfileFromOauthToken(accessToken);
	const profileOrgUUID = profile?.organization?.uuid;
	if (!profileOrgUUID) {
		return null;
	}
	return profileOrgUUID;
}

/**
 * Populate the OAuth account info if it has not already been cached in config.
 * @returns Whether or not the oauth account info was populated.
 */
export async function populateOAuthAccountInfoIfNeeded(): Promise<boolean> {
	// Check env vars first (synchronous, no network call needed).
	// SDK callers like Cowork can provide account info directly, which also
	// eliminates the race condition where early telemetry events lack account info.
	// NB: If/when adding additional SDK-relevant functionality requiring _other_ OAuth account properties,
	// please reach out to #proj-cowork so the team can add additional env var fallbacks.
	const envAccountUuid = process.env.FUSION_CODE_ACCOUNT_UUID;
	const envUserEmail = process.env.FUSION_CODE_USER_EMAIL;
	const envOrganizationUuid = process.env.FUSION_CODE_ORGANIZATION_UUID;
	const hasEnvVars = Boolean(
		envAccountUuid && envUserEmail && envOrganizationUuid,
	);
	if (envAccountUuid && envUserEmail && envOrganizationUuid) {
		if (!getGlobalConfig().oauthAccount) {
			storeOAuthAccountInfo({
				accountUuid: envAccountUuid,
				emailAddress: envUserEmail,
				organizationUuid: envOrganizationUuid,
			});
		}
	}

	const config = getGlobalConfig();
	if (
		(config.oauthAccount &&
			config.oauthAccount.billingType !== undefined &&
			config.oauthAccount.accountCreatedAt !== undefined &&
			config.oauthAccount.subscriptionCreatedAt !== undefined) ||
		!isClaudeAISubscriber() ||
		!hasProfileScope()
	) {
		return false;
	}

	const tokens = getClaudeAIOAuthTokens();
	if (tokens?.accessToken) {
		const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
		if (profile) {
			if (hasEnvVars) {
				logForDebugging(
					"OAuth profile fetch succeeded, overriding env var account info",
					{ level: "info" },
				);
			}
			storeOAuthAccountInfo({
				accountUuid: profile.account.uuid,
				emailAddress: profile.account.email,
				organizationUuid: profile.organization.uuid,
				displayName: profile.account.display_name || undefined,
				hasExtraUsageEnabled:
					profile.organization.has_extra_usage_enabled ?? false,
				billingType: profile.organization.billing_type ?? undefined,
				accountCreatedAt: profile.account.created_at,
				subscriptionCreatedAt:
					profile.organization.subscription_created_at ?? undefined,
			});
			return true;
		}
	}
	return false;
}

export function storeOAuthAccountInfo({
	accountUuid,
	emailAddress,
	organizationUuid,
	displayName,
	hasExtraUsageEnabled,
	billingType,
	accountCreatedAt,
	subscriptionCreatedAt,
}: {
	accountUuid: string;
	emailAddress: string;
	organizationUuid: string | undefined;
	displayName?: string;
	hasExtraUsageEnabled?: boolean;
	billingType?: BillingType;
	accountCreatedAt?: string;
	subscriptionCreatedAt?: string;
}): void {
	const accountInfo: AccountInfo = {
		accountUuid,
		emailAddress,
		organizationUuid,
		hasExtraUsageEnabled,
		billingType,
		accountCreatedAt,
		subscriptionCreatedAt,
	};
	if (displayName) {
		accountInfo.displayName = displayName;
	}
	saveGlobalConfig((current) => {
		// For oauthAccount we need to compare content since it's an object
		if (
			current.oauthAccount?.accountUuid === accountInfo.accountUuid &&
			current.oauthAccount?.emailAddress === accountInfo.emailAddress &&
			current.oauthAccount?.organizationUuid === accountInfo.organizationUuid &&
			current.oauthAccount?.displayName === accountInfo.displayName &&
			current.oauthAccount?.hasExtraUsageEnabled ===
				accountInfo.hasExtraUsageEnabled &&
			current.oauthAccount?.billingType === accountInfo.billingType &&
			current.oauthAccount?.accountCreatedAt === accountInfo.accountCreatedAt &&
			current.oauthAccount?.subscriptionCreatedAt ===
				accountInfo.subscriptionCreatedAt
		) {
			return current;
		}
		return { ...current, oauthAccount: accountInfo };
	});
}
