// #203 Phase B (audit 1.1.3): workflowTemplates public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). Both files public surface. builtinTemplates.js
// imports WorkflowTemplate type from templateManager.js internally — unaffected.
export * from "./builtinTemplates.js";
export * from "./templateManager.js";
