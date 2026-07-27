// log: stub for TS2307 — remoteSkillState feature-gated module

export type DiscoveredRemoteSkillMeta = {
    url: string
    [key: string]: unknown
}

export function stripCanonicalPrefix(name: string): string {
    // log: stub — returns name as-is
    return name
}

export function getDiscoveredRemoteSkill(_slug: string): DiscoveredRemoteSkillMeta | null {
    // log: stub — no remote skills in non-internal builds
    return null
}
