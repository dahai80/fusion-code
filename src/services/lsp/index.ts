// #203 Phase B (audit 1.1.3): lsp public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Internal-only files (config / LSPClient /
// LSPServerInstance / LSPServerManager / passiveFeedback) deliberately NOT
// re-exported — they are private lsp internals.

export * from "./LSPDiagnosticRegistry.js";
export * from "./manager.js";
export * from "./types.js";
