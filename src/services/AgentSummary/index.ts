// #203 Phase B (audit 1.1.3): AgentSummary public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). agentSummary.js is the sole public surface.
export * from "./agentSummary.js";
