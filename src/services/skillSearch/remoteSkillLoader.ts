// log: stub for TS2307 — remoteSkillLoader feature-gated module

export type RemoteSkillLoadResult = {
	cacheHit: boolean;
	latencyMs: number;
	skillPath: string;
	content: string;
	fileCount: number;
	totalBytes: number;
	fetchMethod: string;
};

export async function loadRemoteSkill(
	_slug: string,
	_url: string,
): Promise<RemoteSkillLoadResult> {
	// log: stub — no-op in non-internal builds
	return {
		cacheHit: false,
		latencyMs: 0,
		skillPath: "",
		content: "",
		fileCount: 0,
		totalBytes: 0,
		fetchMethod: "",
	};
}
