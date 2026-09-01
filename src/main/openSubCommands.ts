// `open <cc-url>` connect subcommand registration, extracted from main.tsx
// (audit P2-1 / R17 god-module split, slice C4 — issue #133 pattern).
// Handles headless (-p/--print) connect mode only. Interactive connect (no -p)
// is handled by early argv rewriting in main(), which redirects to the main
// command with full TUI support.
// Coupling note: the action reads the single `_pendingConnect.dangerouslySkipPermissions`
// flag set during early argv processing, so it is passed in as a param (curried
// factory) rather than reaching back into a main.tsx singleton export.

import { feature } from "bun:bundle";
import {
	getOriginalCwd,
	setCwdState,
	setDirectConnectServerUrl,
	setOriginalCwd,
} from "../bootstrap/state.js";
import {
	createDirectConnectSession,
	DirectConnectError,
} from "../server/createDirectConnectSession.js";
import type { DirectConnectConfig } from "../server/directConnectManager.js";
import { gracefulShutdownSync } from "../utils/gracefulShutdown.js";
import type { CommanderCommand } from "./commandHelpers.js";

export function registerOpenCommand(
	program: CommanderCommand,
	getDangerouslySkipPermissions: () => boolean,
): void {
	if (!feature("DIRECT_CONNECT")) return;
	program
		.command("open <cc-url>")
		.description("Connect to a Fusion-Code server (internal — use cc:// URLs)")
		.option("-p, --print [prompt]", "Print mode (headless)")
		.option(
			"--output-format <format>",
			"Output format: text, json, stream-json",
			"text",
		)
		.action((async (
			ccUrl: string,
			opts: {
				print?: string | boolean;
				outputFormat: string;
			},
		) => {
			const { parseConnectUrl } = await import("../server/parseConnectUrl.js");
			const { serverUrl, authToken } = parseConnectUrl(ccUrl);
			let connectConfig: DirectConnectConfig;
			try {
				const session = await createDirectConnectSession({
					serverUrl,
					authToken,
					cwd: getOriginalCwd(),
					dangerouslySkipPermissions: getDangerouslySkipPermissions(),
				});
				if (session.workDir) {
					setOriginalCwd(session.workDir);
					setCwdState(session.workDir);
				}
				setDirectConnectServerUrl(serverUrl);
				connectConfig = session.config;
			} catch (err) {
				console.error(
					err instanceof DirectConnectError ? err.message : String(err),
				);
				gracefulShutdownSync(1);
			}
			const { runConnectHeadless } = await import(
				"../server/connectHeadless.js"
			);
			const prompt = typeof opts.print === "string" ? opts.print : "";
			const interactive = opts.print === true;
			await runConnectHeadless(
				connectConfig,
				prompt,
				opts.outputFormat,
				interactive,
			);
			// biome-ignore lint/suspicious/noExplicitAny: commander extra-typings action overload mismatch — cast matches the inline original
		}) as any);
}
