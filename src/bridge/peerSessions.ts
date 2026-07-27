// log: stub for TS2307 — peerSessions feature-gated module

export type InterClaudeMessageResult = {
	ok: boolean;
	error?: string;
};

export async function postInterClaudeMessage(
	_to: string,
	_message: unknown,
): Promise<InterClaudeMessageResult> {
	// log: stub — no-op in non-internal builds
	return { ok: false, error: "peerSessions not available" };
}
