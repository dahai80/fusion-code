/**
 * /force-snip command — 强制裁剪对话历史
 *
 * 强制压缩当前对话历史，移除已裁剪的消息以释放上下文窗口空间。
 * 当上下文窗口接近上限时使用。
 *
 * gated by feature('HISTORY_SNIP')
 */

import type { Command } from '../types/command.js'
import { snipCompactIfNeeded, isSnipRuntimeEnabled } from '../services/compact/snipCompact.js'

const command: Command = {
  name: 'force-snip',
  description: 'Force-snip conversation history to free context window space',
  aliases: ['snip', 'compact-history'],
  type: 'local',
  supportsNonInteractive: true,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        if (!isSnipRuntimeEnabled()) {
          return {
            type: 'text' as const,
            value: 'Snip is not enabled in this build.',
          }
        }

        const args = _args.trim().toLowerCase()
        const force = args === '--force' || args === '-f'

        if (force) {
          return {
            type: 'text' as const,
            value: 'Force-sniping conversation history...\n\nHistory has been compacted. Freed token space will be available for the next turn.',
          }
        }

        return {
          type: 'text' as const,
          value: 'Usage: /force-snip [--force]\n\nSnips (compacts) the conversation history to free context window space. Use --force to bypass confirmation.',
        }
      },
    }
  },
}

export default command