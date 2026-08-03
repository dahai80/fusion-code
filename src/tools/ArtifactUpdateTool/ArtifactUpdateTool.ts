import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";

export const ARTIFACT_UPDATE_TOOL_NAME = "UpdateArtifact";

import { getArtifactEngineURL } from "../../utils/artifactConfig.js";

const inputSchema = lazySchema(() =>
	z.strictObject({
		artifact_id: z.string().describe("The artifact ID (art_ prefix) to update"),
		content: z.string().describe("New full content for the artifact"),
		change_log: z
			.string()
			.optional()
			.describe("Brief description of what changed"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		artifact_id: z.string(),
		version: z.number(),
		token_count: z.number(),
		ref_text: z.string(),
	}),
);
type ArtifactUpdateOutput = {
	artifact_id: string; // log: fix TS2339
	version: number; // log: fix TS2339
	token_count: number; // log: fix TS2339
	ref_text: string; // log: fix TS2339
};
type OutputSchema = ReturnType<typeof outputSchema>;

async function artifactsRPC(
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

export const ArtifactUpdateTool = buildTool({
	name: ARTIFACT_UPDATE_TOOL_NAME,
	searchHint: "update artifact content with new version",
	maxResultSizeChars: 10_000,
	strict: true,
	async description() {
		return "Update an existing artifact with new content. Creates a new version in the artifact engine and returns an updated reference tag. Previous versions are preserved for rollback.";
	},
	async prompt() {
		return `Use this tool to update an artifact you previously created. Pass the artifact_id (art_xxx) and the new full content. A new version will be created automatically.

The tool returns an updated reference tag with the new version number and token count. Use this when iterating on code or documents that were previously stored as artifacts.

	Prefer incremental edits: When only a section changed, describe the change in change_log rather than rewriting the entire content. This reduces token cost and preserves context window capacity.

	When the PatchArtifact tool becomes available, prefer it over full-content updates for section-level changes (replace_section/append/prepend/delete_section).`;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	userFacingName() {
		return "Update Artifact";
	},
	shouldDefer: true,
	isEnabled() {
		return true;
	},
	toAutoClassifierInput(input) {
		return `${input.artifact_id} ${input.content.length} chars`;
	},
	async checkPermissions(input) {
		return { behavior: "allow", updatedInput: input };
	},
	renderToolUseMessage(input) {
		return `${input.artifact_id} (${input.content.length} chars)`;
	},
	async call({ artifact_id, content, change_log }, _context) {
		const result = await artifactsRPC("artifact.update", {
			artifact_id,
			content,
			change_log: change_log ?? undefined,
		});
		return {
			data: {
				artifact_id: result.id as string,
				version: result.version as number,
				token_count: result.token_count as number,
				ref_text: result.ref_text as string,
			},
		};
	},
	mapToolResultToToolResultBlockParam(
		{ ref_text, artifact_id, version, token_count },
		toolUseID,
	) {
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Artifact updated successfully.\n\nReference: ${ref_text}\n\nID: ${artifact_id} | Version: v${version} | Tokens: ${token_count}`,
		};
	},
} satisfies ToolDef<InputSchema, ArtifactUpdateOutput>);
