// `claude auth` subcommand group registration, extracted from main.tsx
// (issue #133 god-module split). Pure registration; actions delegate to
// ./cli/handlers/auth.js via dynamic import. No render dependency.

import type { CommanderCommand } from "./commandHelpers.js";
import { createSortedHelpConfig } from "./commandHelpers.js";

export function registerAuthCommands(program: CommanderCommand): void {
	// claude auth
	const auth = program
		.command("auth")
		.description("Manage authentication")
		.configureHelp(createSortedHelpConfig());
	auth
		.command("status")
		.description("Show authentication status")
		.option("--json", "Output as JSON (default)")
		.option("--text", "Output as human-readable text")
		.action(async (opts: { json?: boolean; text?: boolean }) => {
			const { authStatus } = await import("../cli/handlers/auth.js");
			await authStatus(opts);
		});
	auth
		.command("logout")
		.description("Log out from your Anthropic account")
		.action(async () => {
			const { authLogout } = await import("../cli/handlers/auth.js");
			await authLogout();
		});
}
