// #203 Phase B (audit 1.1.3): audit public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). auditLog.js is the sole public surface.
export * from "./auditLog.js";
