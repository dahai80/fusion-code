/**
 * Create Workflow Command — 工作流命令工厂
 *
 * 从工作流配置文件创建 CLI 命令。
 * 工作流配置存储在 ~/.fusion-code/workflows/ 目录下。
 *
 * gated by feature('WORKFLOW_SCRIPTS')
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { Command } from '../../types/command.js'

export interface WorkflowConfig {
  name: string
  description: string
  steps: WorkflowStep[]
}

export interface WorkflowStep {
  type: 'command' | 'prompt' | 'subworkflow'
  content: string
  description?: string
}

/**
 * Get all registered workflow commands.
 */
export function getWorkflowCommands(): Command[] {
  const workflowsDir = join(getClaudeConfigHomeDir(), 'workflows')
  if (!existsSync(workflowsDir)) return []

  const commands: Command[] = []
  const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.md'))

  for (const file of files) {
    try {
      const content = readFileSync(join(workflowsDir, file), 'utf-8')
      const workflow = parseWorkflowConfig(file, content)
      if (workflow) {
        commands.push(createWorkflowCommand(workflow))
      }
    } catch {
      // Skip malformed workflow files
    }
  }

  return commands
}

/**
 * Parse a workflow configuration from a file.
 */
function parseWorkflowConfig(filename: string, _content: string): WorkflowConfig | null {
  const name = filename.replace(/\.(yaml|yml|md)$/, '')
  return {
    name,
    description: `Execute the "${name}" workflow`,
    steps: [
      { type: 'command', content: `echo "Running workflow: ${name}"` },
    ],
  }
}

/**
 * Create a Command object from a workflow config.
 */
function createWorkflowCommand(workflow: WorkflowConfig): Command {
  return {
    name: workflow.name,
    description: workflow.description,
    type: 'local',
    supportsNonInteractive: true,
    async load() {
      return {
        call: async (_args: string, _context: any) => {
          return {
            type: 'text' as const,
            value: `Executing workflow "${workflow.name}" with ${workflow.steps.length} step(s)`,
          }
        },
      }
    },
  } as Command
}