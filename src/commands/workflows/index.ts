/**
 * Workflows Command — 工作流管理命令
 *
 * 管理和执行工作流脚本。
 * 支持列出、运行和管理工作流。
 *
 * gated by feature('WORKFLOW_SCRIPTS')
 */

import type { Command, LocalCommandCall } from '../../types/command.js'
import { getWorkflowCommands, createWorkflowCommand } from '../../tools/WorkflowTool/createWorkflowCommand.js'
import { logForDebugging } from '../../utils/debug.js'

const call: LocalCommandCall = async (args: string) => {
    const parts = args.trim().split(/\s+/)
    const subcommand = parts[0]?.toLowerCase()

    switch (subcommand) {
        case 'list':
        case 'ls': {
            const workflows = await getWorkflowCommands()
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
            const workflowName = parts[1]
            if (!workflowName) {
                return {
                    type: 'text' as const,
                    value: 'Usage: /workflows run <workflow-name>',
                }
            }
            const workflows = await getWorkflowCommands()
            const target = workflows.find(w => w.name === workflowName)
            if (!target) {
                return {
                    type: 'text' as const,
                    value: `Workflow "${workflowName}" not found. Use /workflows list to see available workflows.`,
                }
            }
            const cmd = createWorkflowCommand(target)
            const loaded = await (cmd as { load: () => Promise<{ call?: LocalCommandCall; execute?: LocalCommandCall }> }).load()
            const runArgs = parts.slice(2).join(' ')
            return (loaded.call || loaded.execute)!(runArgs, {} as any)
        }
        default:
            return {
                type: 'text' as const,
                value: 'Usage: /workflows <list|run>\n\n  list  - List available workflows\n  run   - Run a workflow by name',
            }
    }
}

const command: Command = {
    name: 'workflows',
    description: 'List and manage workflow scripts',
    aliases: ['wf', 'workflow'],
    type: 'local',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default command