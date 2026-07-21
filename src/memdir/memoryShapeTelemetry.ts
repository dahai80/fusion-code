/**
 * Memory Shape Telemetry — 记忆形状遥测
 *
 * 记录记忆召回和写入的形状数据，用于分析和优化
 * 记忆系统的性能。包括召回的选择率、写入的文件类型等。
 *
 * gated by feature('MEMORY_SHAPE_TELEMETRY')
 */

import { logForDebugging } from '../utils/debug.js'

/**
 * Log memory recall shape data.
 * Records the number of memories considered and selected during recall.
 * Called from findRelevantMemories.ts after each memory search.
 */
export function logMemoryRecallShape<T>(
  memories: T[],
  selected: T[],
): void {
  logForDebugging(
    `[MemoryShape] Recall: ${memories.length} candidates, ${selected.length} selected`,
  )
}

/**
 * Log memory write shape data.
 * Records information about memory writes including tool name, input, and file path.
 * Called from sessionFileAccessHooks.ts after file write/edit operations.
 */
export function logMemoryWriteShape(
  toolName: string,
  _toolInput: Record<string, unknown>,
  filePath: string,
): void {
  logForDebugging(
    `[MemoryShape] Write: ${toolName} → ${filePath}`,
  )
}