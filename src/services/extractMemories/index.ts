// #203 Phase B (audit 1.1.3): extractMemories public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). prompts.js is internal-only (consumed only
// within extractMemories.ts) -> NOT re-exported.
export * from "./extractMemories.js";
