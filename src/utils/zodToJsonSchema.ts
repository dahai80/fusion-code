/**
 * Converts Zod v4 schemas to JSON Schema using native toJSONSchema.
 */

import { toJSONSchema, type ZodTypeAny } from 'zod/v4'
import { logForDebugging } from './debug.js'

export type JsonSchema7Type = Record<string, unknown>

// toolToAPISchema() runs this for every tool on every API request (~60-250
// times/turn). Tool schemas are wrapped with lazySchema() which guarantees the
// same ZodTypeAny reference per session, so we can cache by identity.
const cache = new WeakMap<ZodTypeAny, JsonSchema7Type>()

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema7Type {
    if (typeof schema === 'function') {
        logForDebugging('[zodToJsonSchema] received function instead of schema, calling it')
        try {
            schema = (schema as () => ZodTypeAny)()
        } catch {
            logForDebugging('[zodToJsonSchema] failed to call lazy schema factory')
            return {}
        }
    }
    if (!schema || typeof schema !== 'object' || !('_zod' in schema)) {
        logForDebugging('[zodToJsonSchema] invalid schema object, returning empty')
        return {}
    }
    const hit = cache.get(schema)
    if (hit) return hit
    const result = toJSONSchema(schema) as JsonSchema7Type
    cache.set(schema, result)
    return result
}
