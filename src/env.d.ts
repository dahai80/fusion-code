// Local type stubs for exports stripped from the Anthropic SDK fork.
// These are type-only declarations; no runtime code is generated.

// Missing export from src/utils/betas.js
declare module '../../utils/betas.js' {
    export function getBedrockExtraBodyParamsBetas(): string[]
}

// log: stub for TS2307 — @anthropic-ai/mcpb external package
declare module '@anthropic-ai/mcpb/dist/schemas/any.js' {
    import type { ZodTypeAny } from 'zod/v4'
    export const McpbManifestSchema: ZodTypeAny
}
