import type { ScopedMcpServerConfig } from "../services/mcp/index.js";

// Stub shim for the removed claudeInChrome subtree (audit 1104 cleanup: the
// feature-gated subtree and its Chrome/Anthropic branding were deleted). The
// stubs keep every former call site compiling and byte-identical-safe:
//  - isClaudeInChromeMCPServer => false: no chrome MCP server can exist.
//  - CLAUDE_IN_CHROME_MCP_SERVER_NAME => "": isToolFromMcpServer(name, "") is
//    always false => no chrome tool overrides.
//  - setup fns => false/no-op: enableClaudeInChrome / autoEnable stay false.
//  - setupClaudeInChrome => throw: unreachable when both enable flags are false.
export const isClaudeInChromeMCPServer = (_name: string): boolean => false;
export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = "";
export const CHROME_TOOL_SEARCH_INSTRUCTIONS = "";
export const CLAUDE_IN_CHROME_SKILL_HINT = "";
export const CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER = "";
export const shouldEnableClaudeInChrome = (_chromeFlag?: boolean): boolean =>
	false;
export const shouldAutoEnableClaudeInChrome = (): boolean => false;
export const isChromeExtensionInstalled = (): Promise<boolean> =>
	Promise.resolve(false);
export const setupClaudeInChrome = (): {
	mcpConfig: Record<string, ScopedMcpServerConfig>;
	allowedTools: string[];
	systemPrompt: string;
} => {
	throw new Error("Browser integration not enabled in this build");
};
