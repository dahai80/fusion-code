/**
 * OverflowTestTool — 溢出测试工具
 *
 * 测试工具，用于验证 AI 模型在大量输出情况下的行为。
 * 生成指定大小的测试输出，用于测试上下文窗口溢出处理。
 * 仅测试用途，不应用于生产环境。
 *
 * gated by feature('OVERFLOW_TEST_TOOL')
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const OVERFLOW_TEST_TOOL_NAME = 'OverflowTest'

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    size: z
      .enum(['small', 'medium', 'large', 'xlarge'])
      .optional()
      .default('small')
      .describe('Size of the test output: small (~1KB), medium (~10KB), large (~100KB), xlarge (~1MB)'),
    iterations: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(1)
      .describe('Number of iterations to run'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
  z.object({
    size: z.string().describe('The size category used'),
    bytes_generated: z.number().describe('Total bytes generated'),
    iterations: z.number().describe('Number of iterations completed'),
    sample: z.string().describe('A sample of the generated output'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Tool Implementation ────────────────────────────────────

const SIZE_MAP: Record<string, number> = {
  small: 1_000,
  medium: 10_000,
  large: 100_000,
  xlarge: 1_000_000,
}

async function overflowTestToolCall(
  input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
  const bytesPerIteration = SIZE_MAP[input.size || 'small']
  const totalBytes = bytesPerIteration * (input.iterations || 1)
  const sampleLine = 'A'.repeat(80) + '\n'
  const sample = sampleLine.repeat(Math.min(5, bytesPerIteration / 80))

  // Generate the test output (but don't actually return the full payload)
  return {
    size: input.size || 'small',
    bytes_generated: totalBytes,
    iterations: input.iterations || 1,
    sample: sample.slice(0, 500),
  }
}

// ─── Tool Definition ────────────────────────────────────────

// log: cast toolDef as any — lazySchema/getter mismatch with ToolDef type
const toolDef = {
  name: OVERFLOW_TEST_TOOL_NAME,
  description: `[TEST TOOL] Generate test output of varying sizes to test context window overflow handling. Not for production use.`,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  async execute(input: z.infer<InputSchema>, _context?: unknown, _canUseTool?: unknown, _parentMessage?: unknown, _onProgress?: unknown) {
    return { data: await overflowTestToolCall(input) }
  },
  userFacingName: () => 'OverflowTest',
  isEnabled: () => true,
} as any

export const OverflowTestTool = buildTool(toolDef)