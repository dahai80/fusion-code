// #203 Phase B (audit 1.1.3): autoDream public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). 3 public files (autoDream/config/
// consolidationLock — each has >=1 external consumer). consolidationPrompt
// is internal-only (consumed only within autoDream.ts) → NOT re-exported.
// config imports utils/settings but settings never imports autoDream back
// (only a zod schema field name) — no export * runtime cycle, plain `export *`.
export * from "./autoDream.js";
export * from "./config.js";
export * from "./consolidationLock.js";
