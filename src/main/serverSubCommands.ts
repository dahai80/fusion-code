// Server + ssh subcommand registration, extracted from main.tsx
// (audit P2-1 / R17 god-module split, slice C3 — issue #133 pattern).
// `server` starts an HTTP/unix session server (SessionManager + DangerousBackend
// + lockfile + banner + SIGINT/SIGTERM shutdown); `ssh` is a help-only stub
// (real flow argv-rewritten in main()). Both feature-gated.
// Pure registration; actions delegate to ./server/*.js via dynamic import.
// No module-singleton coupling, no closure over mutable state.

import { feature } from "bun:bundle";
import type { CommanderCommand } from "./commandHelpers.js";

export function registerServerSubCommands(program: CommanderCommand): void {
	// claude server
	if (feature("DIRECT_CONNECT")) {
		program
			.command("server")
			.description("Start a Fusion-Code session server")
			.option("--port <number>", "HTTP port", "0")
			.option("--host <string>", "Bind address", "127.0.0.1")
			.option("--auth-token <token>", "Bearer token for auth")
			.option("--unix <path>", "Listen on a unix domain socket")
			.option(
				"--workspace <dir>",
				"Default working directory for sessions that do not specify cwd",
			)
			.option(
				"--idle-timeout <ms>",
				"Idle timeout for detached sessions in ms (0 = never expire)",
				"600000",
			)
			.option(
				"--max-sessions <n>",
				"Maximum concurrent sessions (0 = unlimited)",
				"32",
			)
			.action(
				async (opts: {
					port: string;
					host: string;
					authToken?: string;
					unix?: string;
					workspace?: string;
					idleTimeout: string;
					maxSessions: string;
				}) => {
					const { randomBytes } = await import("crypto");
					const { startServer } = await import("../server/server.js");
					const { SessionManager } = await import(
						"../server/sessionManager.js"
					);
					const { DangerousBackend } = await import(
						"../server/backends/dangerousBackend.js"
					);
					const { printBanner } = await import("../server/serverBanner.js");
					const { createServerLogger } = await import("../server/serverLog.js");
					const { writeServerLock, removeServerLock, probeRunningServer } =
						await import("../server/lockfile.js");
					const existing = await probeRunningServer();
					if (existing) {
						process.stderr.write(
							`A claude server is already running (pid ${existing.pid}) at ${existing.httpUrl}\n`,
						);
						process.exit(1);
					}
					const authToken =
						opts.authToken ??
						`sk-fc-cc-${randomBytes(16).toString("base64url")}`;
					const config = {
						port: parseInt(opts.port, 10),
						host: opts.host,
						authToken,
						unix: opts.unix,
						workspace: opts.workspace,
						idleTimeoutMs: parseInt(opts.idleTimeout, 10),
						maxSessions: parseInt(opts.maxSessions, 10),
					};
					const backend = new DangerousBackend();
					const sessionManager = new SessionManager(backend, {
						idleTimeoutMs: config.idleTimeoutMs,
						maxSessions: config.maxSessions,
					});
					const logger = createServerLogger();
					const server = startServer(config, sessionManager, logger);
					const actualPort = server.port ?? config.port;
					printBanner(config, authToken, actualPort);
					await writeServerLock({
						pid: process.pid,
						port: actualPort,
						host: config.host,
						httpUrl: config.unix
							? `unix:${config.unix}`
							: `http://${config.host}:${actualPort}`,
						startedAt: Date.now(),
					});
					let shuttingDown = false;
					const shutdown = async () => {
						if (shuttingDown) return;
						shuttingDown = true;
						// Stop accepting new connections before tearing down sessions.
						server.stop(true);
						await sessionManager.destroyAll();
						await removeServerLock();
						process.exit(0);
					};
					process.once("SIGINT", () => void shutdown());
					process.once("SIGTERM", () => void shutdown());
				},
			);
	}

	// `claude ssh <host> [dir]` — registered here only so --help shows it.
	// The actual interactive flow is handled by early argv rewriting in main()
	// (parallels the DIRECT_CONNECT/cc:// pattern above). If commander reaches
	// this action it means the argv rewrite didn't fire (e.g. user ran
	// `claude ssh` with no host) — just print usage.
	if (feature("SSH_REMOTE")) {
		program
			.command("ssh <host> [dir]")
			.description(
				"Run Fusion-Code on a remote host over SSH. Deploys the binary and " +
					"tunnels API auth back through your local machine — no remote setup needed.",
			)
			.option(
				"--permission-mode <mode>",
				"Permission mode for the remote session",
			)
			.option(
				"--dangerously-skip-permissions",
				"Skip all permission prompts on the remote (dangerous)",
			)
			.option(
				"--local",
				"e2e test mode — spawn the child CLI locally (skip ssh/deploy). " +
					"Exercises the auth proxy and unix-socket plumbing without a remote host.",
			)
			.action(async () => {
				// Argv rewriting in main() should have consumed `ssh <host>` before
				// commander runs. Reaching here means host was missing or the
				// rewrite predicate didn't match.
				process.stderr.write(
					"Usage: fusion-code ssh <user@host | ssh-config-alias> [dir]\n\n" +
						"Runs Fusion-Code on a remote Linux host. You don't need to install\n" +
						"anything on the remote or run `claude auth login` there — the binary is\n" +
						"deployed over SSH and API auth tunnels back through your local machine.\n",
				);
				process.exit(1);
			});
	}
}
