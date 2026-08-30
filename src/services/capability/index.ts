// #203 Phase B (audit 1.1.3): capability public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). manifest.js + runtime.js both public
// surface (manifest.ts cross-imports runtime.ts internally — fine).
export * from "./manifest.js";
export * from "./runtime.js";
