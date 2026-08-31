// #203 Phase B (audit 1.1.3): goal public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Both goal files are public surface.

export * from "./budgetEnforcer.js";
export * from "./goalState.js";
