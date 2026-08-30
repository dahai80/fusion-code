// `claude mcp` subcommand group registration, extracted from main.tsx
// (issue #133). Pure registration block; every action delegates to
// ../cli/handlers/mcp.js via dynamic import.

import type { CommanderCommand } from "./commandHelpers.js";
import { createSortedHelpConfig } from "./commandHelpers.js";
import { registerMcpAddCommand } from "../commands/mcp/addCommand.js";
import { registerMcpXaaIdpCommand } from "../commands/mcp/xaaIdpCommand.js";
import { isXaaEnabled } from "../services/mcp/index.js";

export function registerMcpCommands(program: CommanderCommand): void {
	// claude mcp

	const mcp = program
		.command("mcp")
		.description("Configure and manage MCP servers")
		.configureHelp(createSortedHelpConfig())
		.enablePositionalOptions();
	mcp
		.command("serve")
		.description(`Start the Fusion-Code MCP server`)
		.option("-d, --debug", "Enable debug mode", () => true)
		.option(
			"--verbose",
			"Override verbose mode setting from config",
			() => true,
		)
		.action(
			async ({ debug, verbose }: { debug?: boolean; verbose?: boolean }) => {
				const { mcpServeHandler } = await import("../cli/handlers/mcp.js");
				await mcpServeHandler({
					debug,
					verbose,
				});
			},
		);

	// Register the mcp add subcommand (extracted for testability)
	registerMcpAddCommand(mcp);
	if (isXaaEnabled()) {
		registerMcpXaaIdpCommand(mcp);
	}
	mcp
		.command("remove <name>")
		.description("Remove an MCP server")
		.option(
			"-s, --scope <scope>",
			"Configuration scope (local, user, or project) - if not specified, removes from whichever scope it exists in",
		)
		.action(
			async (
				name: string,
				options: {
					scope?: string;
				},
			) => {
				const { mcpRemoveHandler } = await import("../cli/handlers/mcp.js");
				await mcpRemoveHandler(name, options);
			},
		);
	mcp
		.command("list")
		.description(
			"List configured MCP servers. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.",
		)
		.action(async () => {
			const { mcpListHandler } = await import("../cli/handlers/mcp.js");
			await mcpListHandler();
		});
	mcp
		.command("get <name>")
		.description(
			"Get details about an MCP server. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.",
		)
		.action(async (name: string) => {
			const { mcpGetHandler } = await import("../cli/handlers/mcp.js");
			await mcpGetHandler(name);
		});
	mcp
		.command("add-json <name> <json>")
		.description("Add an MCP server (stdio or SSE) with a JSON string")
		.option(
			"-s, --scope <scope>",
			"Configuration scope (local, user, or project)",
			"local",
		)
		.option(
			"--client-secret",
			"Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)",
		)
		.action(
			async (
				name: string,
				json: string,
				options: {
					scope?: string;
					clientSecret?: true;
				},
			) => {
				const { mcpAddJsonHandler } = await import("../cli/handlers/mcp.js");
				await mcpAddJsonHandler(name, json, options);
			},
		);
	mcp
		.command("add-from-claude-desktop")
		.description("Import MCP servers from Claude Desktop (Mac and WSL only)")
		.option(
			"-s, --scope <scope>",
			"Configuration scope (local, user, or project)",
			"local",
		)
		.action(async (options: { scope?: string }) => {
			const { mcpAddFromDesktopHandler } = await import(
				"../cli/handlers/mcp.js"
			);
			await mcpAddFromDesktopHandler(options);
		});
	mcp
		.command("reset-project-choices")
		.description(
			"Reset all approved and rejected project-scoped (.mcp.json) servers within this project",
		)
		.action(async () => {
			const { mcpResetChoicesHandler } = await import("../cli/handlers/mcp.js");
			await mcpResetChoicesHandler();
		});
	mcp
		.command("login <name>")
		.description("Authenticate with an MCP server (starts OAuth flow)")
		.action(async (name: string) => {
			const { mcpLoginHandler } = await import("../cli/handlers/mcp.js");
			await mcpLoginHandler(name);
		});
	mcp
		.command("logout <name>")
		.description("Clear stored authentication for an MCP server")
		.action(async (name: string) => {
			const { mcpLogoutHandler } = await import("../cli/handlers/mcp.js");
			await mcpLogoutHandler(name);
		});
}
