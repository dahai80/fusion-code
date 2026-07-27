import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

export const call: LocalCommandCall = async (args, _context) => {
    const question = args.trim()
    if (!question) {
        return {
            type: 'display',
            display: 'Usage: /aside <your question>\n\nAsk a quick side question without interrupting your current task. The task resumes automatically after answering.',
        } satisfies LocalCommandResult
    }

    console.log('[aside] freezing current task state')

    return {
        type: 'display',
        display: `aside:::${question}`,
        submitNextInput: false,
    } satisfies LocalCommandResult
}
