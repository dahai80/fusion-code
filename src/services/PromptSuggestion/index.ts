// #203 Phase B (audit 1.1.3): PromptSuggestion public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Both files are public surface (each has
// >=1 external consumer), 0 internal-only. promptSuggestion imports
// utils/settings but settings never imports back — no export * runtime cycle
// (unlike the mcp settings→config→settings TDZ hazard), so plain `export *`.
export * from "./promptSuggestion.js";
export * from "./speculation.js";
