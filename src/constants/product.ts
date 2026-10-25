// #220: 上游 claude.com 产品 URL 已去除 — 指向本仓库 (AGPL 来源即在此)。
export const PRODUCT_URL = "https://github.com/dahai80/fusion-code";

// Fusion-Code Remote session URLs
// #220: Anthropic 内部 staging 域名 (claude-ai.staging.ant.dev) 已删除 —
// staging session 只存在于上游内部部署, fusion 构建永不触达。
export const CLAUDE_AI_BASE_URL = "https://claude.ai";
export const CLAUDE_AI_LOCAL_BASE_URL = "http://localhost:4000";

/**
 * Determine if we're in a local-dev environment for remote sessions.
 * Checks session ID format (e.g. `session_local_...`) and ingress URL.
 */
export function isRemoteSessionLocal(
	sessionId?: string,
	ingressUrl?: string,
): boolean {
	return (
		sessionId?.includes("_local_") === true ||
		ingressUrl?.includes("localhost") === true
	);
}

/**
 * Get the base URL for Claude AI based on environment.
 */
export function getClaudeAiBaseUrl(
	sessionId?: string,
	ingressUrl?: string,
): string {
	if (isRemoteSessionLocal(sessionId, ingressUrl)) {
		return CLAUDE_AI_LOCAL_BASE_URL;
	}
	return CLAUDE_AI_BASE_URL;
}

/**
 * Get the full session URL for a remote session.
 *
 * The cse_→session_ translation is a temporary shim gated by
 * tengu_bridge_repl_v2_cse_shim_enabled (see isCseShimEnabled). Worker
 * endpoints (/v1/code/sessions/{id}/worker/*) want `cse_*` but the claude.ai
 * frontend currently routes on `session_*` (compat/convert.go:27 validates
 * TagSession). Same UUID body, different tag prefix. Once the server tags by
 * environment_kind and the frontend accepts `cse_*` directly, flip the gate
 * off. No-op for IDs already in `session_*` form. See toCompatSessionId in
 * src/bridge/sessionIdCompat.ts for the canonical helper (lazy-required here
 * to keep constants/ leaf-of-DAG at module-load time).
 */
export function getRemoteSessionUrl(
	sessionId: string,
	ingressUrl?: string,
): string {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { toCompatSessionId } =
		require("../bridge/sessionIdCompat.js") as typeof import("../bridge/sessionIdCompat.js");
	/* eslint-enable @typescript-eslint/no-require-imports */
	const compatId = toCompatSessionId(sessionId);
	const baseUrl = getClaudeAiBaseUrl(compatId, ingressUrl);
	return `${baseUrl}/code/${compatId}`;
}
