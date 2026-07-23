import type { Command } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const feedback: Command = {
    aliases: ['bug'],
    type: 'local-jsx',
    name: 'feedback',
    description: 'Submit feedback about Fusion-Code',
    argumentHint: '[report]',
    isEnabled: () =>
        !(
            isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) ||
            isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) ||
            isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY) ||
            isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND) ||
            isEnvTruthy(process.env.DISABLE_BUG_COMMAND) ||
            process.env.USER_TYPE === 'ant'
        ),
    async call(onDone, context, args) {
        const { Feedback } = await import('../../components/Feedback.js')
        const initialDescription = args || ''
        return (
            <Feedback
                abortSignal={context.abortController.signal}
                messages={context.messages}
                initialDescription={initialDescription}
                onDone={onDone}
                backgroundTasks={{}}
            />
        )
    },
}

export default feedback
