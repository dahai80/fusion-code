import memoize from "lodash-es/memoize.js";
import type { ScopedMcpServerConfig } from "./types.js";

// claude.ai MCP connectors removed with the cloud account stack: the remote
// catalog fetch (GET /v1/mcp_servers via OAuth) is gone, so the eligible
// connector set is always empty. The merge/dedup plumbing in main.tsx,
// useManageMCPConnections and mcp/config.ts stays and no-ops against {}.
// Local MCP servers (.mcp.json, settings, plugins, --mcp-config) unaffected.

export const fetchClaudeAIMcpConfigsIfEligible = memoize(
	async (): Promise<Record<string, ScopedMcpServerConfig>> => ({}),
);

export function clearClaudeAIMcpConfigsCache(): void {
	fetchClaudeAIMcpConfigsIfEligible.cache.clear?.();
}

export function markClaudeAiMcpConnected(_name: string): void {}

export function hasClaudeAiMcpEverConnected(_name: string): boolean {
	return false;
}
