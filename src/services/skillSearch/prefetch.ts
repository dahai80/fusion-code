// stub for cloud-only skill search prefetch

export async function getTurnZeroSkillDiscovery(
	_input: string,
	_messages: unknown[],
	_context: unknown,
): Promise<
	Array<{
		type: "skill_discovery";
		skills: Array<{ name: string; description: string; shortId?: string }>;
		signal: unknown;
		source: "native" | "aki" | "both";
	}>
> {
	return [];
}

export function startSkillDiscoveryPrefetch(
	_input: unknown,
	_messages: unknown[],
	_context: unknown,
): Promise<unknown> {
	return Promise.resolve(null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function collectSkillDiscoveryPrefetch(
	_pending: unknown,
): Promise<any[]> {
	return [];
}
