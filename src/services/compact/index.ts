// #203 Phase B (audit 1.1.3): compact public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Internal-only files (apiMicrocompact /
// cachedMicrocompact / grouping / hardCompact / prompt / smartCompactV2 /
// timeBasedMCConfig) deliberately NOT re-exported — they are private
// compact internals.
export * from "./compact.js";
export * from "./autoCompact.js";
export * from "./microCompact.js";
export * from "./snipCompact.js";
export * from "./snipProjection.js";
export * from "./reactiveCompact.js";
export * from "./postCompactCleanup.js";
export * from "./compactWarningState.js";
export * from "./cachedMCConfig.js";
export * from "./sessionMemoryCompact.js";
