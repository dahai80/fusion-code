// #203 Phase B (audit 1.1.3): llm public barrel. Consumers outside
// src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). Internal-only files (client/httpClient/
// mlxAdapter/seam) deliberately NOT re-exported — private llm internals.
// The capabilities/ sub-files are re-exported here directly because the
// scanner treats services/llm/capabilities/<x>.js as a deep import into
// the llm subdir (capabilities is not itself a migrated subdir).

export * from "./adapter.js";
export * from "./capabilities/exec.js";
export * from "./capabilities/fs.js";
export * from "./capabilities/sandbox.js";
export * from "./capabilities/tools.js";
export * from "./capability.js";
export * from "./chunkToPart.js";
export * from "./ctx.js";
export * from "./errors.js";
export * from "./registry.js";
export * from "./sseStream.js";
export * from "./streamResume.js";
export * from "./types.js";
