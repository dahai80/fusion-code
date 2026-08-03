import { getArtifactEngineURL } from "../../utils/artifactConfig.js";

export async function artifactsRPC(
	method: string,
	params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
	const body = JSON.stringify({
		jsonrpc: "2.0",
		id: Date.now(),
		method,
		params,
	});
	const resp = await fetch(getArtifactEngineURL(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		signal: AbortSignal.timeout(15000),
	});
	if (!resp.ok) {
		throw new Error(`Artifacts engine HTTP ${resp.status}`);
	}
	const json = (await resp.json()) as Record<string, unknown>;
	if (json.error) {
		throw new Error(
			`Artifacts engine RPC error: ${(json.error as Record<string, unknown>).message}`,
		);
	}
	return (json.result as Record<string, unknown>) ?? {};
}
