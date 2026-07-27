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
    export type CuCallToolResult = { content: unknown[]; isError?: boolean }
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
