import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { artifactsRPC } from "../shared/artifactsRPC.js";

export const ARTIFACT_UPDATE_TOOL_NAME = "UpdateArtifact";

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
	artifact_id: string;
	version: number;
	token_count: number;
	ref_text: string;
};
type OutputSchema = ReturnType<typeof outputSchema>;

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

	For section-level changes, prefer PatchArtifact over full-content updates. PatchArtifact supports replace_section/append/prepend/delete_section operations that modify only the target section, saving tokens and avoiding unnecessary rewrites.

	Use LoadArtifact to review the current content before deciding between PatchArtifact and UpdateArtifact.`;
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
		const version = result.version as Record<string, unknown>;
		return {
			data: {
				artifact_id: version.artifact_id as string,
				version: version.version_num as number,
				token_count: version.token_count as number,
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
