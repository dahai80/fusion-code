/**
 * /fork command — 子 Agent 分支
 *
 * 在当前对话上下文中创建一个子 Agent 分支，
 * 子 Agent 继承父 Agent 的完整对话上下文，
 * 可以独立执行任务并将结果返回给父 Agent。
 *
 * gated by feature('FORK_SUBAGENT')
 */

import type { Command } from '../../types/command.js'
import { isForkSubagentEnabled } from '../../tools/AgentTool/forkSubagent.js'

const command: Command = {
  name: 'fork',
  description: 'Create a sub-agent fork in the current conversation context',
  aliases: ['subagent', 'branch'],
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        if (!isForkSubagentEnabled()) {
          return {
            type: 'text' as const,
            value: 'Fork subagent is not enabled. Set FUSION_CODE_FORK_SUBAGENT=1 to enable.',
          }
        }

        const args = _args.trim()
        if (!args) {
          return {
            type: 'text' as const,
            value: 'Usage: /fork <task description>\n\nCreates a sub-agent fork to complete the specified task in the current conversation context.',
          }
        }

        return {
          type: 'text' as const,
          value: `Forking sub-agent for task: ${args}\n\nSub-agent will inherit the full conversation context and report back when complete.`,
        }
      },
    }
  },
}

export default command