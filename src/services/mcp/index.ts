// #203 Phase B: mcp public barrel. Consumers outside src/services/ must import
// from here, not deep files (enforced by `bun run lint:layers:reverse`).
// Internal-only files (InProcessTransport/SdkControlTransport/headersHelper/
// oauthPort/xaa) deliberately NOT re-exported — they have no outside-services
// consumers and are private mcp internals.

export * from "./auth.js";
export * from "./channelAllowlist.js";
export * from "./channelNotification.js";
export * from "./channelPermissions.js";
export * from "./claudeai.js";
export * from "./client.js";
export * from "./config.js";
export * from "./elicitationHandler.js";
export * from "./envExpansion.js";
export * from "./mcpStringUtils.js";
export * from "./normalization.js";
export * from "./officialRegistry.js";
export * from "./types.js";
export * from "./utils.js";
export * from "./vscodeSdkMcp.js";
export * from "./xaaIdpLogin.js";
