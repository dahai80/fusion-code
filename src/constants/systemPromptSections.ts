import {
  clearBetaHeaderLatches,
  clearSystemPromptSectionState,
  getSystemPromptSectionCache,
  setSystemPromptSectionCacheEntry,
} from '../bootstrap/state.js'
import { logEvent } from '../services/analytics/index.js'
import { isFusionMlxProvider } from '../utils/model/providers.js'

const LOG_PREFIX = '[prefix-cache]'

type ComputeFn = () => string | null | Promise<string | null>

type SystemPromptSection = {
  name: string
  compute: ComputeFn
  cacheBreak: boolean
}

/**
 * Create a memoized system prompt section.
 * Computed once, cached until /clear or /compact.
 */
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}

/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}

/**
 * Resolve all system prompt sections, returning prompt strings.
 */
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  const cache = getSystemPromptSectionCache()

  return Promise.all(
    sections.map(async s => {
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
      const value = await s.compute()
      setSystemPromptSectionCacheEntry(s.name, value)
      return value
    }),
  )
}

/**
 * Clear all system prompt section state. Called on /clear.
 * Also resets beta header latches so a fresh conversation gets fresh
 * evaluation of AFK/fast-mode/cache-editing headers.
 */
export function clearSystemPromptSections(): void {
  clearSystemPromptSectionState()
  clearBetaHeaderLatches()
}

/**
 * Preserve cached system prompt sections across compaction for MLX KV reuse.
 * Only clears null-valued entries; stable sections remain cached so the
 * system prompt prefix stays identical post-compact, allowing MLX to reuse
 * the KV cache for the unchanged prefix.
 *
 * Returns the number of preserved sections for telemetry.
 */
export function preserveCachedSections(): number {
    const cache = getSystemPromptSectionCache()
    const isMlx = isFusionMlxProvider()

    if (!isMlx) {
        clearSystemPromptSectionState()
        clearBetaHeaderLatches()
        return 0
    }

    const nullNames: string[] = []
    let stableCount = 0

    for (const [name, value] of cache) {
        if (value === null) {
            nullNames.push(name)
            cache.delete(name)
        } else {
            stableCount++
        }
    }

    clearBetaHeaderLatches()

    console.log(
        `${LOG_PREFIX} preserved ${stableCount} cached sections for MLX KV reuse (cleared ${nullNames.length} null)`,
    )

    logEvent('prefix_cache_preserved', {
        preserved_sections: stableCount,
        cleared_null: nullNames.length,
    })

    return stableCount
}
