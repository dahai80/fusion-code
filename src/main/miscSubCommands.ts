// Misc subcommand group registration (agents / auto-mode / assistant /
// doctor), extracted from main.tsx (audit P2-1 / R17 god-module split, slice
// C2 — issue #133 pattern). Pure registration; actions delegate to
// ./cli/handlers/*.js via dynamic import. No render dependency, no
// module-singleton coupling.
//
// setup-token / update / up / rollback / install were removed: setup-token
// required a Claude subscription (OAuth removed), and update / up / rollback /
// install were upstream auto-update machinery that downloaded
// @anthropic-ai/claude-code over this fork. Fusion-Code is built from source.

import { feature } from "bun:bundle";
import { getAutoModeEnabledStateIfCached } from "../utils/permissions/permissionSetup.js";
import { getBaseRenderOptions } from "../utils/renderOptions.js";
import type { CommanderCommand } from "./commandHelpers.js";

export function registerMiscSubCommands(program: CommanderCommand): void {
	// Agents command - list configured agents
	program
		.command("agents")
		.description("List configured agents")
		.option(
			"--setting-sources <sources>",
			"Comma-separated list of setting sources to load (user, project, local).",
		)
		.action(async () => {
			const { agentsHandler } = await import("../cli/handlers/agents.js");
			await agentsHandler();
			process.exit(0);
		});
	if (feature("TRANSCRIPT_CLASSIFIER")) {
		// Skip when tengu_auto_mode_config.enabled === 'disabled' (circuit breaker).
		// Reads from disk cache — GrowthBook isn't initialized at registration time.
		if (getAutoModeEnabledStateIfCached() !== "disabled") {
			const autoModeCmd = program
				.command("auto-mode")
				.description("Inspect auto mode classifier configuration");
			autoModeCmd
				.command("defaults")
				.description(
					"Print the default auto mode environment, allow, and deny rules as JSON",
				)
				.action(async () => {
					const { autoModeDefaultsHandler } = await import(
						"../cli/handlers/autoMode.js"
					);
					autoModeDefaultsHandler();
					process.exit(0);
				});
			autoModeCmd
				.command("config")
				.description(
					"Print the effective auto mode config as JSON: your settings where set, defaults otherwise",
				)
				.action(async () => {
					const { autoModeConfigHandler } = await import(
						"../cli/handlers/autoMode.js"
					);
					autoModeConfigHandler();
					process.exit(0);
				});
			autoModeCmd
				.command("critique")
				.description("Get AI feedback on your custom auto mode rules")
				.option("--model <model>", "Override which model is used")
				.action(async (options) => {
					const { autoModeCritiqueHandler } = await import(
						"../cli/handlers/autoMode.js"
					);
					await autoModeCritiqueHandler(options);
					process.exit();
				});
		}
	}

	// Remote Control command — connect local environment to claude.ai/code.
	// The actual command is intercepted by the fast-path in cli.tsx before
	// Commander.js runs, so this registration exists only for help output.
	// Always hidden: isBridgeEnabled() at this point (before enableConfigs)
	// would throw inside isClaudeAISubscriber → getGlobalConfig and return
	// false via the try/catch — but not before paying ~65ms of side effects
	// (25ms settings Zod parse + 40ms sync `security` keychain subprocess).
	// The dynamic visibility never worked; the command was always hidden.
	if (feature("KAIROS")) {
		program
			.command("assistant [sessionId]")
			.description(
				"Attach the REPL as a client to a running bridge session. Discovers sessions via API if no sessionId given.",
			)
			.action(() => {
				// Argv rewriting above should have consumed `assistant [id]`
				// before commander runs. Reaching here means a root flag came first
				// (e.g. `--debug assistant`) and the position-0 predicate
				// didn't match. Print usage like the ssh stub does.
				process.stderr.write(
					"Usage: fusion-code assistant [sessionId]\n\n" +
						"Attach the REPL as a viewer client to a running bridge session.\n" +
						"Omit sessionId to discover and pick from available sessions.\n",
				);
				process.exit(1);
			});
	}

	// Doctor command - check installation health
	program
		.command("doctor")
		.description(
			"Check the health of your Fusion-Code installation. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.",
		)
		.action(async () => {
			const [{ doctorHandler }, { createRoot }] = await Promise.all([
				import("../cli/handlers/util.js"),
				import("../ink.js"),
			]);
			const root = await createRoot(getBaseRenderOptions(false));
			await doctorHandler(root);
		});
}
