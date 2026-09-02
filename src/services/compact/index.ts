// #203 Phase B (audit 1.1.3): compact public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Internal-only files (apiMicrocompact /
// cachedMicrocompact / grouping / hardCompact / prompt / smartCompactV2 /
// timeBasedMCConfig) deliberately NOT re-exported — they are private
// compact internals.

export * from "./autoCompact.js";
export * from "./cachedMCConfig.js";
// insight-0902 E3: lastCompactionSnapshot 公开 (供 /diff-compaction 命令跨层消费)。
export * from "./lastCompactionSnapshot.js";
export * from "./compact.js";
export * from "./compactWarningState.js";
export * from "./microCompact.js";
export * from "./postCompactCleanup.js";
export * from "./reactiveCompact.js";
export * from "./sessionMemoryCompact.js";
export * from "./snipCompact.js";
export * from "./snipProjection.js";
