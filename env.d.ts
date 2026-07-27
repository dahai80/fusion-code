declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL?: string
  NATIVE_PACKAGE_URL?: string
  FEEDBACK_CHANNEL?: string
  ISSUES_EXPLAINER?: string
  VERSION_CHANGELOG?: string
}

declare module '*.node' {
  const value: unknown
  export default value
}

declare module '@ant/computer-use-mcp' {
    export const API_RESIZE_PARAMS: Record<string, unknown>
    export const targetImageSize: { width: number; height: number }
    export function buildComputerUseTools(): unknown[]
    export function bindSessionContext(ctx: unknown): unknown
    export type ComputerUseSessionContext = Record<string, unknown>
    export type CuCallToolResult = { content: unknown[]; isError?: boolean; telemetry?: { error_kind?: string } } // log: fix TS2339
    export type CuPermissionRequest = { toolName: string; input: Record<string, unknown> }
    export type CuPermissionResponse = { granted: boolean; flags?: number }
    export const DEFAULT_GRANT_FLAGS: number
    export type ScreenshotDims = { width: number; height: number }
}

declare module '@ant/computer-use-mcp/types' {
    export type CoordinateMode = 'pixels' | 'normalized'
    export type CuSubGates = Record<string, boolean>
    export type CuPermissionRequest = { toolName: string; input: Record<string, unknown> }
    export type CuPermissionResponse = { granted: boolean; flags?: number }
    export const DEFAULT_GRANT_FLAGS: number
}

declare module 'image-processor-napi' {
    export function processImage(input: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<Buffer>
}

declare module 'url-handler-napi' {
    export function registerHandler(callback: (url: string) => void): void
    export function unregisterHandler(): void
}

declare module 'modifiers-napi' {
    export function getModifiers(): number
}

declare module 'audio-capture-napi' {
    export function startCapture(options?: Record<string, unknown>): Promise<unknown>
    export function stopCapture(): Promise<void>
}

declare module '@ant/computer-use-swift' {
    const _mod: unknown
    export default _mod
}

declare module '@ant/computer-use-input' {
    const _mod: unknown
    export default _mod
}

declare module '@ant/claude-for-chrome-mcp' {
    const _mod: unknown
    export default _mod
}

declare module '@ant/computer-use-mcp/sentinelApps' {
    export const sentinelAppNames: string[]
}


declare module 'react/compiler-runtime' {
    export function c(size: number): any[]
}

declare module '@ant/computer-use-swift' {
    export function execute(args: Record<string, unknown>): Promise<unknown>
}

declare module '@ant/computer-use-input' {
    export function sendInput(input: Record<string, unknown>): Promise<void>
}

declare module '@ant/claude-for-chrome-mcp' {
    export const tools: unknown[]
}

declare module '@ant/computer-use-mcp/sentinelApps' {
    export const SENTINEL_APPS: string[]
}

declare module 'audio-capture-napi' {
    export function startCapture(options?: Record<string, unknown>): Promise<unknown>
    export function stopCapture(): Promise<Buffer>
}

// Stripped internal modules from Anthropic fork
declare module './utils/debug.js' {
    export function logForDebugging(message: string, options?: { level?: string }): void
}
declare module '../utils/debug.js' {
    export function logForDebugging(message: string, options?: { level?: string }): void
}
declare module '../utils/envUtils.js' {
    export function getClaudeConfigHomeDir(): string
    export function isEnvTruthy(key: string): boolean
}
declare module './sdk/settingsTypes.generated.js' {
    export type Settings = Record<string, unknown>
}

// Anthropic documentation stubs (stripped from fork)
declare module './claude-api/*' {
    const content: string
    export default content
}
declare module '../claude-api/*' {
    const content: string
    export default content
}

// Stripped server infrastructure
declare module './server/*' {
    export default undefined
}
declare module './server/*.js' {
    export default undefined
}

// Stripped Anthropic-only modules (1-2 references each)
declare module '*.md' {
    const content: string
    export default content
}

declare namespace NodeJS {
    interface ProcessEnv {
        USER_TYPE?: 'external' | 'ant'
    }
}

// Stripped Anthropic-only runtime functions
declare function fireCompanionObserver(messages: unknown, callback: (reaction: unknown) => void): Promise<void>

// Missing module stubs for src/main.tsx
declare module 'src/utils/eventLoopStallDetector.js' {
    export function startEventLoopStallDetector(): void
}
declare module 'src/utils/sdkHeapDumpMonitor.js' {
    export function startSdkMemoryMonitor(): void
}
declare module 'src/utils/sessionDataUploader.js' {
    const _default: unknown
    export default _default
}
declare module 'src/bridge/bridgeMain.js' {
    export function bridgeMain(args: string[]): Promise<void>
}
declare module 'src/utils/ccshareResume.js' {
    export function parseCcshareId(input: string): string | undefined
    export function loadCcshare(id: string, opts?: { print?: string | boolean; outputFormat: string }): Promise<void>
}
