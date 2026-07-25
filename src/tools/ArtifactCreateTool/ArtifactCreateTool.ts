import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const ARTIFACT_CREATE_TOOL_NAME = 'CreateArtifact'

import { getArtifactEngineURL } from '../../utils/artifactConfig.js'

const inputSchema = lazySchema(() =>
    z.strictObject({
        name: z.string().describe('Artifact filename, e.g. "fusion_agent.py"'),
        type: z.enum(['code', 'markdown', 'html', 'react', 'data']).describe('Artifact type'),
        content: z.string().describe('Full content of the artifact'),
        summary: z.string().max(100).optional().describe('Short summary ≤100 chars for model awareness without full content'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        artifact_id: z.string(),
        name: z.string(),
        version: z.number(),
        token_count: z.number(),
        ref_text: z.string(),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

async function artifactsRPC(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
    const resp = await fetch(getArtifactEngineURL(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
        throw new Error(`Artifacts engine HTTP ${resp.status}`)
    }
    const json = (await resp.json()) as Record<string, unknown>
    if (json.error) {
        throw new Error(`Artifacts engine RPC error: ${(json.error as Record<string, unknown>).message}`)
    }
    return (json.result as Record<string, unknown>) ?? {}
}

export const ArtifactCreateTool = buildTool({
    name: ARTIFACT_CREATE_TOOL_NAME,
    searchHint: 'create artifact for large generated content',
    maxResultSizeChars: 10_000,
    strict: true,
    async description() {
        return 'Create an artifact to store large generated content (code, documents, HTML apps, data files). Returns a lightweight reference tag that replaces the full content in the conversation, saving context tokens.'
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

When you need to show or modify the content later, use the UpdateArtifact tool with the artifact_id.`
    },
    get inputSchema(): InputSchema {
        return inputSchema()
    },
    get outputSchema(): OutputSchema {
        return outputSchema()
    },
    userFacingName() {
        return 'Create Artifact'
    },
    shouldDefer: true,
    isEnabled() {
        return true
    },
    toAutoClassifierInput(input) {
        return `${input.type} ${input.name} ${input.content.length} chars`
    },
    async checkPermissions(input) {
        return { behavior: 'allow', updatedInput: input }
    },
    renderToolUseMessage(input) {
        return `${input.type}/${input.name} (${input.content.length} chars)`
    },
    async call({ name, type, content, summary }, _context) {
        const sessionId = getSessionId()
        const result = await artifactsRPC('artifact.create', {
            session_id: sessionId,
            name,
            type,
            content,
            summary: summary ?? undefined,
        })
        return {
            data: {
                artifact_id: result.id as string,
                name: result.name as string,
                version: result.version as number,
                token_count: result.token_count as number,
                ref_text: result.ref_text as string,
            },
        }
    },
    mapToolResultToToolResultBlockParam({ ref_text, artifact_id, name, version, token_count }, toolUseID) {
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: `Artifact created successfully.\n\nReference: ${ref_text}\n\nID: ${artifact_id} | Name: ${name} | Version: v${version} | Tokens saved: ${token_count}\n\nUse UpdateArtifact to modify this artifact in future turns.`,
        }
    },
} satisfies ToolDef<InputSchema, OutputSchema>)
