// #203 Phase B (audit 1.1.3): taskHealth public barrel. Consumers outside
// src/services/ must import from here, not deep files (enforced by
// bun run lint:layers:reverse). All 4 files public surface. crashRecovery.js
// and taskHealthMonitor.js import notificationManager.js internally — unaffected.
export * from "./crashRecovery.js";
export * from "./notificationManager.js";
export * from "./taskHealthMonitor.js";
export * from "./taskReaper.js";
