/**
 * Connect headless — cloud-only stub
 *
 * log: fix TS2339
 */

export async function runConnectHeadless(
    _config: unknown,
    _prompt: string,
    _outputFormat: string,
    _interactive: boolean,
): Promise<void> {
    throw new Error('runConnectHeadless is not available in this build')
}
