import { z } from "zod/v4";
import { getSessionId } from "../../bootstrap/state.js";
import type { CanUseToolFn } from "../../hooks/useCanUseTool.js";
import {
	buildTool,
	type ToolCallProgress,
	type ToolDef,
	type ToolUseContext,
} from "../../Tool.js";
import type { AssistantMessage } from "../../types/message.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { artifactsRPC } from "../shared/artifactsRPC.js";

export const ARTIFACT_CREATE_TOOL_NAME = "CreateArtifact";

const inputSchema = lazySchema(() =>
	z.strictObject({
		name: z.string().describe('Artifact filename, e.g. "fusion_agent.py"'),
		type: z
			.enum(["code", "markdown", "html", "react", "data"])
			.describe("Artifact type"),
		content: z.string().describe("Full content of the artifact"),
		summary: z
			.string()
			.max(100)
			.optional()
			.describe(
				"Short summary ≤100 chars for model awareness without full content",
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
	z.object({
		artifact_id: z.string(),
		name: z.string(),
		version: z.number(),
		token_count: z.number(),
		ref_text: z.string(),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;
type Output = z.infer<OutputSchema>;

export const ArtifactCreateTool = buildTool({
	name: ARTIFACT_CREATE_TOOL_NAME,
	searchHint: "create artifact for large generated content",
	maxResultSizeChars: 10_000,
	strict: true,
	async description() {
		return "Create an artifact to store large generated content (code, documents, HTML apps, data files). Returns a lightweight reference tag that replaces the full content in the conversation, saving context tokens.";
	},
	async prompt() {
		return `Use this tool when you generate content that exceeds ~30 lines of code or ~1500 chars of text. The artifact engine stores full content externally and returns a compact reference tag (~80 tokens) that keeps the conversation context lean.

Artifact types:
- code: source code files (.py, .ts, .js, etc.)
- markdown: documents, READMEs, specs
- html: standalone HTML applications
- react: React components (JSX/TSX)
- data: JSON, CSV, YAML data files

The reference tag format: [Artifact: name | ID: art_xxx | Version: v1 | Type: code | Tokens: 4200 | Summary: ...]

When you need to show or modify the content later, use the UpdateArtifact tool with the artifact_id.
For section-level changes, use PatchArtifact instead of rewriting the full content.
To review artifact content, use LoadArtifact.

	Auto-trigger rule: When your streaming output exceeds ~30 lines or ~1500 chars, automatically invoke this tool instead of dumping raw content into the chat.

	Long document structure guide (bookend pattern):
	- Opening section: table of contents, core constraints, key terminology
	- Body: actual content organized by sections
	- Closing section: change log, pending optimizations, open questions
	This structure enables efficient incremental modifications (replace_section/append) without rewriting the entire document.`;
	},
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	userFacingName() {
		return "Create Artifact";
	},
	shouldDefer: true,
	isEnabled() {
		return true;
	},
	toAutoClassifierInput(input) {
		return `${input.type} ${input.name} ${input.content.length} chars`;
	},
	async checkPermissions(input) {
		return { behavior: "allow", updatedInput: input };
	},
	renderToolUseMessage(input) {
		return `${input.type}/${input.name} (${input.content.length} chars)`;
	},
	async call(
		{ name, type, content, summary }: z.infer<InputSchema>,
		_context: ToolUseContext,
		_canUseTool: CanUseToolFn,
		_parentMessage: AssistantMessage,
		_onProgress?: ToolCallProgress,
	) {
		const sessionId = getSessionId();
		const result = await artifactsRPC("artifact.create", {
			session_id: sessionId,
			name,
			type,
			content,
			summary: summary ?? undefined,
		});
		const artifact = result.artifact as Record<string, unknown>;
		const version = result.version as Record<string, unknown>;
		return {
			data: {
				artifact_id: artifact.id as string,
				name: artifact.name as string,
				version: version.version_num as number,
				token_count: version.token_count as number,
				ref_text: result.ref_text as string,
			},
		};
	},
	mapToolResultToToolResultBlockParam(content, toolUseID) {
		const { ref_text, artifact_id, name, version, token_count } =
			content as unknown as Output;
		return {
			tool_use_id: toolUseID,
			type: "tool_result",
			content: `Artifact created successfully.\n\nReference: ${ref_text}\n\nID: ${artifact_id} | Name: ${name} | Version: v${version} | Tokens saved: ${token_count}\n\nUse UpdateArtifact to modify this artifact in future turns. Use PatchArtifact for section-level changes.`,
		};
	},
} satisfies ToolDef<InputSchema, Output>);
