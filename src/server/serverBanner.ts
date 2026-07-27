/**
 * Server banner — cloud-only stub
 *
 * log: fix TS2339
 */

export function printBanner(
    _config: Record<string, unknown>,
    _authToken: string,
    _port: number,
): void {
    throw new Error('printBanner is not available in this build')
}
