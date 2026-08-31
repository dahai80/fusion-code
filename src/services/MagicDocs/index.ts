// #203 Phase B (audit 1.1.3): MagicDocs public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). Both files public surface. magicDocs.js
// imports buildMagicDocsUpdatePrompt from prompts.js internally — unaffected.
export * from "./magicDocs.js";
export * from "./prompts.js";
