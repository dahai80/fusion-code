/**
 * Server logger — cloud-only stub
 *
 * log: fix TS2339
 */

export interface ServerLogger {
	info(msg: string): void;
	error(msg: string): void;
}

export function createServerLogger(): ServerLogger {
	throw new Error("createServerLogger is not available in this build");
}
