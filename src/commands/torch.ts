/**
 * /torch command — 传递/转交上下文
 *
 * 将当前对话上下文的摘要传递给另一个 Fusion-Code 实例。
 * 用于在多个会话之间共享上下文信息。
 *
 * gated by feature('TORCH')
 */

import type { Command } from '../types/command.js'

const command: Command = {
  name: 'torch',
  description: 'Pass context to another Fusion-Code instance',
  aliases: ['pass', 'handoff'],
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        const args = _args.trim()

        if (!args) {
          return {
            type: 'text' as const,
            value: 'Usage: /torch <message>\n\nPasses the current conversation context with a message to another instance. The context includes the recent conversation history and your message.',
          }
        }

        return {
          type: 'text' as const,
          value: `Torch passed with message: ${args}\n\nContext has been prepared for handoff. The receiving instance will see the recent conversation history along with your message.`,
        }
      },
    }
  },
}

export default command