import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { artifactsRPC } from "../shared/artifactsRPC.js";

export const ARTIFACT_LOAD_TOOL_NAME = "LoadArtifact";

const inputSchema = lazySchema(() =>
	z.strictObject({
		artifact_id: z.string().describe("The artifact ID (art_ prefix) to load"),
		preview_only: z
			.boolean()
			.optional()
			.describe("If true, return TOC + summary only (no full content)"),
		section: z
			.string()
			.optional()
			.describe("Load only this section by anchor name (e.g. 'Chapter 2')"),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		artifact_id: z.string(),
		content: z.string().nullable(),
		token_count: z.number(),
		version: z.number(),
		sections: z
			.array(
				z.object({
					anchor: z.string(),
					tokens: z.number(),
				}),
			)
			.optional(),
		summary: z.string().optional(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;
type Output = z.infer<OutputSchema>;

export const LoadArtifactTool = buildTool({
	name: ARTIFACT_LOAD_TOOL_NAME,
	searchHint: "load artifact content for review or before patching",
	maxResultSizeChars: 100_000,
	strict: true,
	async description() {
		return "Load artifact content. Use preview_only=true for TOC+summary, or section to load a specific chapter.";
	},
	async prompt() {
		return `Use this tool to load artifact content. Pass the artifact_id (art_xxx).

Modes:
- Full content (default): no extra params → returns full content + token count + version
- Preview only: set preview_only=true → returns sections list + summary, content is null
- Section load: set section="Chapter 2" → returns only that section's content

Common use cases:
- Before PatchArtifact: use preview_only=true to see section anchors, then section="..." to load just the part you need
- Review full content before deciding how to modify
- Check available sections in a large document without loading everything
- Recover context after conversation compaction

Section anchor matching: markdown headings and code function/class names. Prefix # is optional ("Chapter 2" and "# Chapter 2" both work).`;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	userFacingName() {
		return "Load Artifact";
	},
	shouldDefer: true,
	isEnabled() {
		return true;
	},
	toAutoClassifierInput(input) {
		return `${input.artifact_id}${input.preview_only ? " preview" : ""}${input.section ? ` section=${input.section}` : ""}`;
	},
	async checkPermissions(input) {
		return { behavior: "allow", updatedInput: input };
	},
	renderToolUseMessage(input) {
		const mode = input.preview_only
			? "preview"
			: input.section
				? `section=${input.section}`
				: "full";
		return `${input.artifact_id} (${mode})`;
	},
	async call({ artifact_id, preview_only, section }, _context) {
		const params: Record<string, unknown> = { artifact_id };
		if (preview_only !== undefined) params.preview_only = preview_only;
		if (section !== undefined) params.section = section;
		const result = await artifactsRPC("artifact.load", params);
		const sections = result.sections as
			| Array<{ anchor: string; tokens: number }>
			| undefined;
		return {
			data: {
				artifact_id,
				content: (result.content as string | null) ?? null,
				token_count: result.total_tokens as number,
				version: result.version as number,
				sections,
				summary: result.summary as string | undefined,
			},
		};
	},
	mapToolResultToToolResultBlockParam(
		{ artifact_id, content, token_count, version, sections, summary },
		toolUseID,
	) {
		let body = `Artifact: ${artifact_id} | Version: v${version} | Tokens: ${token_count}`;
		if (sections && sections.length > 0) {
			body += `\nSections: ${sections.map((s) => `${s.anchor} (${s.tokens}t)`).join(", ")}`;
		}
		if (summary) {
			body += `\nSummary: ${summary}`;
		}
		if (content) {
			const preview =
				content.length > 2000
					? `${content.slice(0, 2000)}\n... (${content.length - 2000} more chars)`
					: content;
			body += `\n\n${preview}`;
		} else {
			body +=
				"\n\n[Content not loaded — use without preview_only to get full content, or set section to load a specific part]";
		}
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: body,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
