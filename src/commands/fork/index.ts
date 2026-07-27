import type { Command } from '../../types/command.js'
import { isForkSubagentEnabled } from '../../tools/AgentTool/forkSubagent.js'

const command: Command = {
    name: 'fork',
    description: 'Create a sub-agent fork in the current conversation context',
    aliases: ['subagent', 'branch'],
    type: 'local-jsx',
    async load() {
        return {
            call: async (onDone, context, args) => {
                if (!isForkSubagentEnabled()) {
                    onDone('Fork subagent is not enabled. Set FUSION_CODE_FORK_SUBAGENT=1 to enable.')
                    return null
                }

                const trimmed = args.trim()
                if (!trimmed) {
                    onDone('Usage: /fork <task description>\n\nCreates a sub-agent fork to complete the specified task in the current conversation context.')
                    return null
                }

                onDone(`Forking sub-agent for: ${trimmed}`, {
                    shouldQuery: true,
                    nextInput: `Fork a sub-agent to complete this task independently: ${trimmed}`,
                    submitNextInput: true,
                })
                return null
            },
        }
    },
}

export default command
