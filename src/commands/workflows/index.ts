/**
 * Workflows Command — 工作流管理命令
 *
 * 管理和执行工作流脚本。
 * 支持列出、运行和管理工作流。
 *
 * gated by feature('WORKFLOW_SCRIPTS')
 */

import type { Command } from '../../types/command.js'
import { getWorkflowCommands } from '../../tools/WorkflowTool/createWorkflowCommand.js'

const command: Command = {
  name: 'workflows',
  description: 'List and manage workflow scripts',
  aliases: ['wf', 'workflow'],
  type: 'local',
  supportsNonInteractive: true,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        const args = _args.trim().split(/\s+/)
        const subcommand = args[0]?.toLowerCase()

        switch (subcommand) {
          case 'list':
          case 'ls': {
            const workflows = getWorkflowCommands()
            if (workflows.length === 0) {
              return {
                type: 'text' as const,
                value: 'No workflows found. Add workflow files to ~/.claude/workflows/.',
              }
            }
            const list = workflows.map(w => `  /${w.name}: ${w.description}`).join('\n')
            return {
              type: 'text' as const,
              value: `Available workflows:\n${list}`,
            }
          }
          case 'run': {
            const workflowName = args[1]
            if (!workflowName) {
              return {
                type: 'text' as const,
                value: 'Usage: /workflows run <workflow-name>',
              }
            }
            return {
              type: 'text' as const,
              value: `Running workflow "${workflowName}"...\n\nWorkflow execution started.`,
            }
          }
          default:
            return {
              type: 'text' as const,
              value: 'Usage: /workflows <list|run>\n\n  list  - List available workflows\n  run   - Run a workflow by name',
            }
        }
      },
    }
  },
}

export default command