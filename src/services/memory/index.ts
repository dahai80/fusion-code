// #203 Phase B (audit 1.1.3): memory public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). All 3 impl files public surface
// (commitTurn/retrieveContext import fusionMemoryClient internally —
// unaffected). Test files (commitTurn.test/fusionMemoryClient.test/
// retrieveContext.test) are NOT public surface -> NOT re-exported.
export * from "./commitTurn.js";
export * from "./fusionMemoryClient.js";
export * from "./retrieveContext.js";
