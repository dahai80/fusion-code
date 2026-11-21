/**
 * Memory Shape Telemetry — memory shape telemetry
 *
 * Records shape data for memory recall and writes, used to analyze and optimize
 * memory system performance. Includes recall selection rates, written file types, and more.
 *
 * gated by feature('MEMORY_SHAPE_TELEMETRY')
 */

import { logForDebugging } from "../utils/debug.js";

/**
 * Log memory recall shape data.
 * Records the number of memories considered and selected during recall.
 * Called from findRelevantMemories.ts after each memory search.
 */
export function logMemoryRecallShape<T>(memories: T[], selected: T[]): void {
	logForDebugging(
		`[MemoryShape] Recall: ${memories.length} candidates, ${selected.length} selected`,
	);
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
	logForDebugging(`[MemoryShape] Write: ${toolName} → ${filePath}`);
}
