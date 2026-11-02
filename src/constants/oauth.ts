// OAuth constants — trimmed to the non-login surface (P2 1102 cleanup):
// the Anthropic OAuth login/token-exchange/roles/api-key flows were removed;
// only the profile reader, keychain file suffix, and MCP OAuth client
// metadata remain.

export function fileSuffixForOauthConfig(): string {
	if (process.env.FUSION_CODE_CUSTOM_OAUTH_URL) {
		return "-custom-oauth";
	}
	return "";
}

export const CLAUDE_AI_INFERENCE_SCOPE = "user:inference" as const;
export const CLAUDE_AI_PROFILE_SCOPE = "user:profile" as const;
export const OAUTH_BETA_HEADER = "oauth-2025-04-20" as const;

type OauthConfig = {
	BASE_API_URL: string;
	OAUTH_FILE_SUFFIX: string;
};

const PROD_OAUTH_CONFIG = {
	BASE_API_URL: "https://api.anthropic.com",
	// No suffix for production config
	OAUTH_FILE_SUFFIX: "",
} as const;

/**
 * Client ID Metadata Document URL for MCP OAuth (CIMD / SEP-991).
 * When an MCP auth server advertises client_id_metadata_document_supported: true,
 * Fusion-Code uses this URL as its client_id instead of Dynamic Client Registration.
 * The URL must point to a JSON document hosted by Anthropic.
 * See: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
export const MCP_CLIENT_METADATA_URL =
	"https://claude.ai/oauth/claude-code-client-metadata";

export function getOauthConfig(): OauthConfig {
	return PROD_OAUTH_CONFIG;
}
