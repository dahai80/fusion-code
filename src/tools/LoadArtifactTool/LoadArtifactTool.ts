import { z } from "zod/v4";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { artifactsRPC } from "../shared/artifactsRPC.js";

export const ARTIFACT_LOAD_TOOL_NAME = "LoadArtifact";

const inputSchema = lazySchema(() =>
    z.strictObject({
        artifact_id: z
            .string()
            .describe("The artifact ID (art_ prefix) to load"),
        version: z
            .union([z.string(), z.number()])
            .optional()
            .describe('Version number or "latest" (default: latest)'),
    }),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
    z.object({
        artifact_id: z.string(),
        content: z.string(),
        token_count: z.number(),
        version: z.number(),
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
        return "Load the content of an existing artifact. Returns the full content, token count, and version number. Use this to review artifact content before patching or updating.";
    },
    async prompt() {
        return `Use this tool to load the content of an artifact you previously created or that exists in the current session. Pass the artifact_id (art_xxx) and optionally a specific version number.

Common use cases:
- Review the current content before deciding how to modify it
- Check the content before using PatchArtifact (to identify correct anchor names)
- Compare content across versions by loading different versions
- Recover context about an artifact after conversation compaction

The response includes the full content, token count, and version number. For large artifacts, consider whether you need the full content or just a specific section — if only a section matters, use PatchArtifact with replace_section to modify it without loading everything.`;
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
        return `${input.artifact_id} v${input.version ?? "latest"}`;
    },
    async checkPermissions(input) {
        return { behavior: "allow", updatedInput: input };
    },
    renderToolUseMessage(input) {
        return `${input.artifact_id} (v${input.version ?? "latest"})`;
    },
    async call({ artifact_id, version }, _context) {
        const params: Record<string, unknown> = { artifact_id };
        if (version !== undefined) {
            params.version = version;
        }
        const result = await artifactsRPC("artifact.get_content", params);
        return {
            data: {
                artifact_id,
                content: result.content as string,
                token_count: result.token_count as number,
                version: result.version as number,
            },
        };
    },
    mapToolResultToToolResultBlockParam(
        { artifact_id, content, token_count, version },
        toolUseID,
    ) {
        const preview =
            content.length > 2000
                ? `${content.slice(0, 2000)}\n... (${content.length - 2000} more chars)`
                : content;
        return {
            tool_use_id: toolUseID,
            type: "tool_result",
            content: `Artifact loaded: ${artifact_id} | Version: v${version} | Tokens: ${token_count}\n\n${preview}`,
        };
    },
} satisfies ToolDef<InputSchema, Output>);
