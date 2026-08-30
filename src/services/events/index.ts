export { eventStream } from './eventStream.js'
export type { FusionEvent, EventSeverity } from './eventStream.js'
// #203 Phase B (audit 1.1.3): events public barrel re-exports. Consumers
// outside src/services/** must import from here, not deep files (enforced by
// `bun run lint:layers:reverse`). No name collisions across the four files.
export * from './SessionEvent.js'
export * from './eventLog.js'
export * from './deriveMessages.js'
