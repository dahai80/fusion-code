import type { Command } from '../../commands.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

const usage = {
    type: 'local-jsx',
    name: 'usage',
    aliases: ['stats', 'cost'],
    description: 'Show your Fusion-Code usage statistics, activity, and session cost',
    load: () => import('./stats.js'),
} satisfies Command

export default usage
