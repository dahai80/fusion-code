// log: stub for TS2307 — udsClient feature-gated module

export async function sendToUdsSocket(
    _target: string,
    _message: unknown,
): Promise<void> {
    // log: stub — no-op in non-internal builds
}

export async function listAllLiveSessions(): Promise<string[]> {
    // log: stub — returns empty in non-internal builds
    return []
}
