// log: stub for TS2307 — remoteSkillLoader feature-gated module

export async function loadRemoteSkill(
    _slug: string,
    _url: string,
): Promise<unknown> {
    // log: stub — no-op in non-internal builds
    return null
}
