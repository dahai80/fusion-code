/**
 * fusion-mlx 工具调用校验器
 *
 * 在客户端侧消灭工具调用 JSON 解析失败：
 * 1. cleanSchema：清洗工具 Schema，移除本地模型易出错的复杂嵌套
 * 2. validateToolCall：强校验模型返回的工具调用结果
 * 3. repairToolCall：尝试修复常见的格式错误
 */

/** 清洗单个工具的 inputSchema，移除不规范的字段 */
export function cleanSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) {
    return { type: 'object', properties: {} }
  }
  const s = schema as Record<string, unknown>
  const cleaned: Record<string, unknown> = {}

  if (typeof s.type === 'string') {
    cleaned.type = s.type
  } else {
    cleaned.type = 'object'
  }

  if (s.properties && typeof s.properties === 'object') {
    cleaned.properties = cleanProperties(s.properties as Record<string, unknown>)
  } else {
    cleaned.properties = {}
  }

  if (Array.isArray(s.required)) {
    cleaned.required = s.required.filter((r: unknown) => typeof r === 'string')
  }

  return cleaned
}

/** 递归清洗 properties 对象 */
function cleanProperties(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(props)) {
    if (typeof val !== 'object' || val === null) continue
    const v = val as Record<string, unknown>
    const cleaned: Record<string, unknown> = {}
    if (typeof v.type === 'string') cleaned.type = v.type
    if (typeof v.description === 'string') {
      cleaned.description = v.description.length > MLX_MAX_PROPERTY_DESCRIPTION_LENGTH
        ? v.description.slice(0, MLX_MAX_PROPERTY_DESCRIPTION_LENGTH).replace(/\s+\S*$/, '') + '...'
        : v.description
    }
    if (v.enum && Array.isArray(v.enum)) cleaned.enum = v.enum
    if (v.items) cleaned.items = cleanSchema(v.items)
    if (v.properties && typeof v.properties === 'object') {
      cleaned.properties = cleanProperties(v.properties as Record<string, unknown>)
    }
    if (Array.isArray(v.required)) {
      cleaned.required = v.required.filter((r: unknown) => typeof r === 'string')
    }
    // 移除 additionalProperties、$schema、default 等本地模型易混淆字段
    result[key] = cleaned
  }
  return result
}

// Local models have limited context — truncate tool descriptions to save tokens.
const MLX_MAX_DESCRIPTION_LENGTH = 200
const MLX_MAX_PROPERTY_DESCRIPTION_LENGTH = 80

/** 批量清洗 Anthropic 工具列表为 MLX 安全格式 */
export function cleanToolList(tools: unknown[]): unknown[] {
  if (!Array.isArray(tools)) return []
  return tools
    .map((tool) => {
      if (typeof tool !== 'object' || tool === null) return null
      const t = tool as Record<string, unknown>
      const desc = typeof t.description === 'string' ? t.description : ''
      return {
        name: t.name,
        description: desc.length > MLX_MAX_DESCRIPTION_LENGTH
          ? desc.slice(0, MLX_MAX_DESCRIPTION_LENGTH).replace(/\s+\S*$/, '') + '...'
          : desc,
        input_schema: cleanSchema(t.input_schema ?? t.inputSchema ?? t.schema),
      }
    })
    .filter(Boolean)
}

/** 工具调用结果校验器 */
export interface ValidationResult {
  valid: boolean
  error?: string
  repaired?: unknown
}

/** 校验并尝试修复模型返回的工具调用 JSON */
export function validateToolCall(rawArgs: string, expectedSchema?: unknown): ValidationResult {
  if (!rawArgs || typeof rawArgs !== 'string') {
    return { valid: false, error: '工具参数为空' }
  }

  // 尝试直接 JSON.parse
  let parsed: unknown
  let wasRepaired = false
  try {
    parsed = JSON.parse(rawArgs)
  } catch (e) {
    // JSON 解析失败，尝试修复常见错误
    const repaired = repairJson(rawArgs)
    if (repaired !== null) {
      try {
        parsed = JSON.parse(repaired)
        wasRepaired = true
      } catch {
        return { valid: false, error: `JSON 解析失败: ${(e as Error).message}` }
      }
    } else {
      return { valid: false, error: `JSON 解析失败: ${(e as Error).message}` }
    }
  }

  // Schema conformance check: verify required fields exist and types match
  if (expectedSchema && typeof expectedSchema === 'object' && parsed && typeof parsed === 'object') {
    const schema = expectedSchema as Record<string, unknown>
    const obj = parsed as Record<string, unknown>
    const errors: string[] = []

    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (typeof req !== 'string') continue
        if (!(req in obj)) {
          errors.push(`missing required field "${req}"`)
        }
      }
    }

    // Check property types
    if (schema.properties && typeof schema.properties === 'object') {
      const props = schema.properties as Record<string, unknown>
      for (const [key, propDef] of Object.entries(props)) {
        if (typeof propDef !== 'object' || propDef === null) continue
        const pDef = propDef as Record<string, unknown>
        const value = obj[key]
        if (value === undefined) continue // missing optional fields are OK
        if (pDef.type === 'string' && typeof value !== 'string') {
          errors.push(`field "${key}" should be string, got ${typeof value}`)
        } else if (pDef.type === 'number' && typeof value !== 'number') {
          errors.push(`field "${key}" should be number, got ${typeof value}`)
        } else if (pDef.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`field "${key}" should be boolean, got ${typeof value}`)
        } else if (pDef.type === 'array' && !Array.isArray(value)) {
          errors.push(`field "${key}" should be array, got ${typeof value}`)
        } else if (pDef.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
          errors.push(`field "${key}" should be object`)
        }
      }
    }

    if (errors.length > 0) {
      // Schema mismatch — still pass the parsed result but flag the error
      // Tool-level Zod validation will catch these, but early detection
      // helps with debugging and avoids confusing downstream errors
      return { valid: true, repaired: parsed, error: `schema issues: ${errors.join('; ')}` }
    }
  }

  if (wasRepaired) {
    return { valid: true, repaired: parsed, error: '已自动修复' }
  }
  return { valid: true, repaired: parsed }
}

/** 修复模型常见的 JSON 格式错误 */
function repairJson(raw: string): string | null {
  let s = raw.trim()

  // 1. 移除前后的 markdown 代码块标记
  const fenceOpen = /^```(?:json)?\s*/i
  const fenceClose = /\s*```$/i
  s = s.replace(fenceOpen, '').replace(fenceClose, '')

  // 2. 补全缺失的结尾括号
  const openBraces = (s.match(/\{/g) || []).length
  const closeBraces = (s.match(/\}/g) || []).length
  if (openBraces > closeBraces) {
    s += '}'
  }
  const openParens = (s.match(/\[/g) || []).length
  const closeParens = (s.match(/\]/g) || []).length
  if (openParens > closeParens) {
    s += ']'
  }

  // 3. 修复未引用的字符串值（关键字后跟逗号或右括号）
  const unquotedValue = /:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s([,}\]])/g
  s = s.replace(unquotedValue, ': "$1"$2')
  const unquotedValueEnd = /:\s*([a-zA-Z_][a-zA-Z0-9_]*)$/g
  s = s.replace(unquotedValueEnd, ': "$1"')

  // 4. 移除尾部多余的逗号
  const trailingComma = /,\s*([}\]])/g
  s = s.replace(trailingComma, '$1')

  // 5. 修复单引号为双引号
  s = s.replace(/'/g, '"')

  // 6. 处理被截断的 JSON（从最后一个完整的 key-value 对截断并补全）
  if (s.includes('{') && !s.endsWith('}') && !s.endsWith(']')) {
    const lastComma = s.lastIndexOf(',')
    const lastColonStr = s.lastIndexOf(': "')
    const lastColonObj = s.lastIndexOf(': {')
    const lastCompletePos = Math.max(lastComma, lastColonStr, lastColonObj)
    if (lastCompletePos > 0) {
      const truncated = s.slice(0, lastCompletePos).replace(/,\s*$/, '')
      const openB = (truncated.match(/\{/g) || []).length
      const closeB = (truncated.match(/\}/g) || []).length
      let result = truncated
      for (let i = 0; i < openB - closeB; i++) result += '}'
      return result
    }
  }

  return s
}
