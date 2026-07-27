/**
 * Server — cloud-only server stub
 *
 * log: fix TS2339
 */

export interface ServerInstance {
    port?: number
    stop(immediate?: boolean): void
}

export function startServer(
    _config: Record<string, unknown>,
    _sessionManager: unknown,
    _logger: unknown,
): ServerInstance {
    throw new Error('Server mode is not available in this build')
}
