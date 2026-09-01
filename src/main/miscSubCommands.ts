// Misc subcommand group registration (setup-token / agents / auto-mode /
// assistant / doctor / update / up / rollback / install), extracted from
// main.tsx (audit P2-1 / R17 god-module split, slice C2 — issue #133 pattern).
// Pure registration; actions delegate to ./cli/handlers/*.js via dynamic import.
// No render dependency, no module-singleton coupling.

import { feature } from "bun:bundle";
import type { CommanderCommand } from "./commandHelpers.js";
import { isInternalBuild } from "../utils/buildConstants.js";
import { getBaseRenderOptions } from "../utils/renderOptions.js";
import { getAutoModeEnabledStateIfCached } from "../utils/permissions/permissionSetup.js";

export function registerMiscSubCommands(program: CommanderCommand): void {
	// Setup token command
	program
		.command("setup-token")
		.description(
			"Set up a long-lived authentication token (requires Claude subscription)",
		)
		.action(async () => {
			const [{ setupTokenHandler }, { createRoot }] = await Promise.all([
				import("../cli/handlers/util.js"),
				import("../ink.js"),
			]);
			const root = await createRoot(getBaseRenderOptions(false));
			await setupTokenHandler(root);
		});

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
			"Check the health of your Fusion-Code auto-updater. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.",
		)
		.action(async () => {
			const [{ doctorHandler }, { createRoot }] = await Promise.all([
				import("../cli/handlers/util.js"),
				import("../ink.js"),
			]);
			const root = await createRoot(getBaseRenderOptions(false));
			await doctorHandler(root);
		});

	// claude update
	//
	// For SemVer-compliant versioning with build metadata (X.X.X+SHA):
	// - We perform exact string comparison (including SHA) to detect any change
	// - This ensures users always get the latest build, even when only the SHA changes
	// - UI shows both versions including build metadata for clarity
	program
		.command("update")
		.alias("upgrade")
		.description("Check for updates and install if available")
		.action(async () => {
			const { update } = await import("../cli/update.js");
			await update();
		});

	// claude up — run the project's CLAUDE.md "# claude up" setup instructions.
	if (isInternalBuild()) {
		program
			.command("up")
			.description(
				'[ANT-ONLY] Initialize or upgrade the local dev environment using the "# claude up" section of the nearest CLAUDE.md',
			)
			.action(async () => {
				const { up } = await import("../cli/up.js");
				await up();
			});
	}

	// claude rollback (ant-only)
	// Rolls back to previous releases
	if (isInternalBuild()) {
		program
			.command("rollback [target]")
			.description(
				"[ANT-ONLY] Roll back to a previous release\n\nExamples:\n  claude rollback                                    Go 1 version back from current\n  claude rollback 3                                  Go 3 versions back from current\n  claude rollback 2.0.73-dev.20251217.t190658        Roll back to a specific version",
			)
			.option("-l, --list", "List recent published versions with ages")
			.option("--dry-run", "Show what would be installed without installing")
			.option(
				"--safe",
				"Roll back to the server-pinned safe version (set by oncall during incidents)",
			)
			.action(
				async (
					target?: string,
					options?: {
						list?: boolean;
						dryRun?: boolean;
						safe?: boolean;
					},
				) => {
					const { rollback } = await import("../cli/rollback.js");
					await rollback(target, options);
				},
			);
	}

	// claude install
	program
		.command("install [target]")
		.description(
			"Install Fusion-Code native build. Use [target] to specify version (stable, latest, or specific version)",
		)
		.option("--force", "Force installation even if already installed")
		.action(
			async (
				target: string | undefined,
				options: {
					force?: boolean;
				},
			) => {
				const { installHandler } = await import("../cli/handlers/util.js");
				await installHandler(target, options);
			},
		);
}
