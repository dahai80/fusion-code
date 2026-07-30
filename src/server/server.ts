/**
 * Server — project-level API for Fusion Studio integration.
 *
 * Delegates to projectApiServer which uses Bun.serve()
 * with routes for project context, sessions, and memory.
 */

import { startProjectApiServer } from "./projectApiServer.js";
import type { ServerConfig } from "./types.js";

export interface ServerInstance {
	port: number;
	stop(immediate?: boolean): void;
}

export function startServer(
	config: ServerConfig,
	_sessionManager: unknown,
	_logger: unknown,
): ServerInstance {
	const instance = startProjectApiServer(config);
	return {
		port: instance.port,
		stop(_immediate?: boolean) {
			instance.stop();
		},
	};
}
