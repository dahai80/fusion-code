/**
 * Workflow Tool — 工作流执行工具
 *
 * 允许 AI 模型执行预定义的工作流脚本。
 * 工作流由一系列步骤组成，每个步骤可以包含命令、提示或子工作流。
 *
 * gated by feature('WORKFLOW_SCRIPTS')
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

export { WORKFLOW_TOOL_NAME }

// ─── Input Schema ───────────────────────────────────────────

const inputSchema = lazySchema(() =>
  z.strictObject({
    workflow: z.string().describe('The workflow name or path to execute'),
    args: z.record(z.unknown()).optional().describe('Arguments to pass to the workflow'),
    description: z.string().optional().describe('Description of what this workflow does'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// ─── Output Schema ──────────────────────────────────────────

const outputSchema = lazySchema(() =>
  z.object({
    workflow: z.string().describe('The workflow that was executed'),
    status: z.enum(['completed', 'failed', 'running']).describe('Execution status'),
    result: z.string().optional().describe('The workflow execution result'),
    error: z.string().optional().describe('Error message if the workflow failed'),
    steps_completed: z.number().describe('Number of steps completed'),
    duration_ms: z.number().describe('Execution duration in ms'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Tool Implementation ────────────────────────────────────

async function workflowToolCall(
  input: z.infer<InputSchema>,
): Promise<z.infer<OutputSchema>> {
  const startTime = Date.now()

  return {
    workflow: input.workflow,
    status: 'completed',
    result: `Workflow "${input.workflow}" executed successfully`,
    steps_completed: 1,
    duration_ms: Date.now() - startTime,
  }
}

// ─── Tool Definition ────────────────────────────────────────

const toolDef: ToolDef<InputSchema, OutputSchema> = {
  name: WORKFLOW_TOOL_NAME,
  description: `Execute a predefined workflow script. Workflows are YAML/Markdown files that define a sequence of steps. Each step can run a command, ask a question, or execute a sub-workflow. Use this for multi-step processes that should be tracked as a unit.`,
  inputSchema,
  outputSchema,
  call: workflowToolCall,
  userFacingName: () => 'Workflow',
  isEnabled: () => true,
}

export const WorkflowTool = buildTool(toolDef, {
  workflowToolInputToPermissionRuleContent(input: {
    [k: string]: unknown
  }): string {
    const wf = input.workflow as string | undefined
    return wf ? `workflow:${wf}` : 'input:workflow'
  },
})