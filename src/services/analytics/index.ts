/**
 * Analytics service - public API for event logging
 *
 * The open build intentionally ships without product telemetry. We keep this
 * module as a compatibility boundary so existing call sites can remain
 * unchanged while all analytics become inert.
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  return metadata
}

type LogEventMetadata = { [key: string]: boolean | number | undefined }

export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

export function attachAnalyticsSink(_newSink: AnalyticsSink): void {}

export function logEvent(
  _eventName: string,
  _metadata: LogEventMetadata,
): void {}

export async function logEventAsync(
  _eventName: string,
  _metadata: LogEventMetadata,
): Promise<void> {}

export function _resetForTesting(): void {}

// #203 Phase B (audit 1.1.3): analytics barrel re-export completion.
// Consumers outside src/services/ must import from here, not deep files (enforced
// by bun run lint:layers:reverse). The inert stubs above (logEvent/attachAnalyticsSink/
// stripProtoFields/_resetForTesting/AnalyticsSink/logEventAsync) remain the
// compatibility boundary for the open build's no-telemetry API. The real
// implementation files below are ALREADY bundled in the open build (89+ consumers
// deep-import growthbook alone) — `export *` here re-routes the import graph
// through the barrel without adding code (tree-shaken at symbol level). No name
// collision: real impl uses distinct names (logEventTo1P/initializeAnalyticsSink/
// GrowthBook-*) vs the inert stubs above. firstPartyEventLoggingExporter.ts is
// internal-only (consumed within firstPartyEventLogger.ts) → NOT re-exported.
export * from "./config.js";
export * from "./datadog.js";
export * from "./firstPartyEventLogger.js";
export * from "./growthbook.js";
export * from "./metadata.js";
export * from "./sink.js";
export * from "./sinkKillswitch.js";
