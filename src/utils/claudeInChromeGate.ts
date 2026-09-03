import { feature } from "bun:bundle";
import type { ScopedMcpServerConfig } from "../services/mcp/index.js";

// Gate shim for the claudeInChrome subtree. When CHROME is OFF (default builds),
// the conditional require() block below is dead-code-eliminated, so the entire
// src/utils/claudeInChrome/ subtree (common/prompt/setup/toolRendering/mcpServer/
// package/setupPortable/chromeNativeHost) is tree-shaken out of the compiled
// binary — eliminating all Anthropic/Chrome branding strings from shipping builds.
//
// Stubs are byte-identical-safe when OFF:
//  - isClaudeInChromeMCPServer => false: no chrome MCP server can exist when the
//    setup wiring is stubbed off, so reserved-name checks never fire.
//  - CLAUDE_IN_CHROME_MCP_SERVER_NAME => "": isToolFromMcpServer(name, "") is
//    always false => hasChromeTools=false (no chrome tools when off).
//  - setup fns => false/no-op: enableClaudeInChrome / autoEnable stay false.
//  - setupClaudeInChrome => throw: unreachable when both enable flags are false.
let _isClaudeInChromeMCPServer: (name: string) => boolean = () => false;
let _CLAUDE_IN_CHROME_MCP_SERVER_NAME = "";
let _CHROME_TOOL_SEARCH_INSTRUCTIONS = "";
let _CLAUDE_IN_CHROME_SKILL_HINT = "";
let _CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER = "";
let _shouldEnableClaudeInChrome: (chromeFlag?: boolean) => boolean = () => false;
let _shouldAutoEnableClaudeInChrome: () => boolean = () => false;
let _isChromeExtensionInstalled: () => Promise<boolean> = async () => false;
let _setupClaudeInChrome: () => {
	mcpConfig: Record<string, ScopedMcpServerConfig>;
	allowedTools: string[];
	systemPrompt: string;
} = () => {
	throw new Error("Browser integration not enabled in this build");
};

if (feature("CHROME")) {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const common = require("./claudeInChrome/common.js");
	const prompt = require("./claudeInChrome/prompt.js");
	const setup = require("./claudeInChrome/setup.js");
	/* eslint-enable @typescript-eslint/no-require-imports */
	_isClaudeInChromeMCPServer = common.isClaudeInChromeMCPServer;
	_CLAUDE_IN_CHROME_MCP_SERVER_NAME = common.CLAUDE_IN_CHROME_MCP_SERVER_NAME;
	_CHROME_TOOL_SEARCH_INSTRUCTIONS = prompt.CHROME_TOOL_SEARCH_INSTRUCTIONS;
	_CLAUDE_IN_CHROME_SKILL_HINT = prompt.CLAUDE_IN_CHROME_SKILL_HINT;
	_CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER =
		prompt.CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER;
	_shouldEnableClaudeInChrome = setup.shouldEnableClaudeInChrome;
	_shouldAutoEnableClaudeInChrome = setup.shouldAutoEnableClaudeInChrome;
	_isChromeExtensionInstalled = setup.isChromeExtensionInstalled;
	_setupClaudeInChrome = setup.setupClaudeInChrome;
}

export const isClaudeInChromeMCPServer = _isClaudeInChromeMCPServer;
export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = _CLAUDE_IN_CHROME_MCP_SERVER_NAME;
export const CHROME_TOOL_SEARCH_INSTRUCTIONS = _CHROME_TOOL_SEARCH_INSTRUCTIONS;
export const CLAUDE_IN_CHROME_SKILL_HINT = _CLAUDE_IN_CHROME_SKILL_HINT;
export const CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER =
	_CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER;
export const shouldEnableClaudeInChrome = _shouldEnableClaudeInChrome;
export const shouldAutoEnableClaudeInChrome = _shouldAutoEnableClaudeInChrome;
export const isChromeExtensionInstalled = _isChromeExtensionInstalled;
export const setupClaudeInChrome = _setupClaudeInChrome;
