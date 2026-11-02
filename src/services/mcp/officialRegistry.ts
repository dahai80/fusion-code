// Official MCP registry fetch removed with the cloud stack (P2 1102 cleanup).
// isOfficialMcpUrl is kept as a fail-closed lookup (always false without the
// registry) for the analytics metadata call site.
export function isOfficialMcpUrl(_normalizedUrl: string): boolean {
	return false;
}
