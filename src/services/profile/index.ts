// #203 Phase B (audit 1.1.3): profile public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). profile.js + builtinProfiles.js both public
// (mutual cross-import internally — unaffected by barrel). All external
// deep imports target profile.js; builtinProfiles re-exported for completeness.
export * from "./profile.js";
export * from "./builtinProfiles.js";
