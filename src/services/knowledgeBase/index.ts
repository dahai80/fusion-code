// #203 Phase B (audit 1.1.3): knowledgeBase public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). All 4 files public surface. kbManager.js
// is the central hub (imports chunker/embedder/vectorStore internally —
// unaffected by barrel).
export * from "./chunker.js";
export * from "./embedder.js";
export * from "./kbManager.js";
export * from "./vectorStore.js";
