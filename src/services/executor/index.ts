// #203 Phase B (audit 1.1.3): executor public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Internal-only files (ExecutorClient /
// ExecutorInstance) deliberately NOT re-exported — private executor internals.
export * from "./executorDriver.js";
export * from "./turnSnapshot.js";
export * from "./types.js";
export * from "./manager.js";
