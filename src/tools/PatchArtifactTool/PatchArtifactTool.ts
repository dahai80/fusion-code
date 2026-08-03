import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { artifactsRPC } from "../shared/artifactsRPC.js";

export const ARTIFACT_PATCH_TOOL_NAME = "PatchArtifact";

const inputSchema = lazySchema(() =>
	z.strictObject({
		artifact_id: z.string().describe("The artifact ID (art_ prefix) to patch"),
		operation: z
			.enum(["replace_section", "append", "prepend", "delete_section"])
			.describe("Patch operation type"),
		anchor: z
			.string()
			.optional()
			.describe(
				"Section heading or function name to target (required for replace_section and delete_section)",
			),
		content: z
			.string()
			.optional()
			.describe("New content for replace_section/append/prepend operations"),
		expected_version: z
			.number()
			.optional()
			.describe("Optimistic lock — fail if current version does not match"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		artifact_id: z.string(),
		new_version: z.number(),
		tokens_added: z.number(),
		tokens_removed: z.number(),
		tokens_net: z.number(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;
type Output = z.infer<OutputSchema>;

export const PatchArtifactTool = buildTool({
	name: ARTIFACT_PATCH_TOOL_NAME,
	searchHint: "patch artifact with incremental section-level edit",
	maxResultSizeChars: 10_000,
	strict: true,
	async description() {
		return "Apply an incremental patch to an artifact — modify, append, prepend, or delete a section without rewriting the full content. Saves tokens compared to UpdateArtifact.";
	},
	async prompt() {
		return `Apply an incremental patch to an existing artifact. This is more efficient than UpdateArtifact for section-level changes because it only modifies the targeted part.

Operations:
- **replace_section**: Replace a section identified by anchor with new content. Anchor matches section headings (markdown) or function/class names (code).
- **append**: Add content to the end of the artifact.
- **prepend**: Add content to the beginning of the artifact.
- **delete_section**: Remove a section identified by anchor.

Anchor matching rules:
- **Markdown artifacts**: anchor matches heading text (e.g., "## API Reference" → anchor="API Reference"). Matches are case-sensitive and must be exact.
- **Code artifacts**: anchor matches function or class names (e.g., "def process_data" → anchor="process_data").
- If multiple sections match the anchor, the operation fails with an error listing the matching line numbers — you must use a more specific anchor.

Optimistic lock: Pass expected_version to ensure you're patching the version you expect. If someone else updated the artifact since you last checked, the patch will fail.

Tips:
- Use LoadArtifact first to review the current content and identify correct anchor names.
- For large refactors touching many sections, consider UpdateArtifact with full content instead.
- Always include the section heading in replace_section content (the old heading is removed entirely).`;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	userFacingName() {
		return "Patch Artifact";
	},
	shouldDefer: true,
	isEnabled() {
		return true;
	},
	toAutoClassifierInput(input) {
		return `${input.artifact_id} ${input.operation} ${input.anchor ?? ""}`;
	},
	async checkPermissions(input) {
		return { behavior: "allow", updatedInput: input };
	},
	renderToolUseMessage(input) {
		const parts = [input.artifact_id, input.operation];
		if (input.anchor) parts.push(`anchor=${input.anchor}`);
		if (input.content) parts.push(`${input.content.length} chars`);
		return parts.join(" ");
	},
	async call(
		{ artifact_id, operation, anchor, content, expected_version },
		_context,
	) {
		const params: Record<string, unknown> = {
			artifact_id,
			operation,
		};
		if (anchor !== undefined) params.anchor = anchor;
		if (content !== undefined) params.content = content;
		if (expected_version !== undefined)
			params.expected_version = expected_version;
		const result = await artifactsRPC("artifact.patch", params);
		const patchInfo = result.patch_info as Record<string, unknown>;
		return {
			data: {
				artifact_id: patchInfo.artifact_id as string,
				new_version: patchInfo.new_version as number,
				tokens_added: patchInfo.tokens_added as number,
				tokens_removed: patchInfo.tokens_removed as number,
				tokens_net: patchInfo.tokens_net as number,
			},
		};
	},
	mapToolResultToToolResultBlockParam(
		{ artifact_id, new_version, tokens_added, tokens_removed, tokens_net },
		toolUseID,
	) {
		const netSign = tokens_net >= 0 ? "+" : "";
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Artifact patched: ${artifact_id} | New version: v${new_version} | Tokens: +${tokens_added}/-${tokens_removed} (${netSign}${tokens_net} net)`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
