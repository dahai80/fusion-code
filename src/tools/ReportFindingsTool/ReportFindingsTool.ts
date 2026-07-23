import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { REPORT_FINDINGS_TOOL_NAME } from './constants.js'
import { DESCRIPTION, getPrompt } from './prompt.js'

const FINDING_SCHEMA = z.strictObject({
    file: z.string().describe('Repo-relative path of the file the finding is in'),
    line: z
        .number()
        .optional()
        .describe('1-indexed line the finding anchors to'),
    summary: z.string().describe('One-sentence statement of the defect'),
    short_summary: z
        .string()
        .optional()
        .describe('Compressed label for compact UI (≤60 chars)'),
    failure_scenario: z
        .string()
        .optional()
        .describe('Concrete inputs/state → wrong output/crash'),
    category: z
        .string()
        .optional()
        .describe('Short kebab-case slug of the finding type (e.g. "correctness", "simplification", "efficiency", "test-coverage")'),
    verdict: z
        .enum(['CONFIRMED', 'PLAUSIBLE'])
        .optional()
        .describe('Set when a verify pass ran; absent on inline-only reviews'),
    outcome: z
        .enum(['fixed', 'skipped', 'no_change_needed'])
        .optional()
        .describe('Set ONLY when re-reporting after applying fixes: what happened to this finding'),
})

const inputSchema = lazySchema(() =>
    z.strictObject({
        level: z
            .enum(['low', 'medium', 'high', 'xhigh', 'max'])
            .describe('Effort level the review ran at'),
        findings: z
            .array(FINDING_SCHEMA)
            .max(32)
            .describe('Verified findings, most-severe first; empty if none survived'),
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
    z.object({
        count: z.number(),
        level: z.string(),
    }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ReportFindingsTool = buildTool({
    name: REPORT_FINDINGS_TOOL_NAME,
    searchHint: 'report code review findings',
    maxResultSizeChars: 100_000,
    async description() {
        return DESCRIPTION
    },
    async prompt() {
        return getPrompt()
    },
    get inputSchema(): InputSchema {
        return inputSchema()
    },
    get outputSchema(): OutputSchema {
        return outputSchema()
    },
    async execute({ level, findings }, _context, _toolContext) {
        return {
            data: {
                count: findings.length,
                level,
            },
        }
    },
    mapToolResultToToolResultBlockParam(content, toolUseID) {
        const { count, level } = content as Output
        return {
            tool_use_id: toolUseID,
            type: 'tool_result',
            content: count === 0
                ? `No findings survived verification (level: ${level}).`
                : `${count} finding(s) reported (level: ${level}).`,
        }
    },
} satisfies ToolDef<InputSchema, Output>)
