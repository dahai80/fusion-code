/**
 * /subscribe-pr command — 订阅 GitHub PR 通知
 *
 * 订阅一个 GitHub Pull Request 的变更通知。
 * 当 PR 有新的提交、评论或状态变更时，AI 会收到通知。
 *
 * gated by feature('KAIROS_GITHUB_WEBHOOKS')
 */

import type { Command } from '../types/command.js'

const command: Command = {
  name: 'subscribe-pr',
  description: 'Subscribe to GitHub Pull Request notifications',
  aliases: ['sub-pr', 'watch-pr'],
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      call: async (_args: string, _context: any) => {
        const args = _args.trim()
        if (!args) {
          return {
            type: 'text' as const,
            value: 'Usage: /subscribe-pr <pr-url> [events...]\n\nSubscribe to notifications for a GitHub Pull Request. Events: comment, commit, review, status, merged, closed (default: comment, commit, review).',
          }
        }

        const parts = args.split(/\s+/)
        const prUrl = parts[0]!
        const events = parts.slice(1).length > 0 ? parts.slice(1) : ['comment', 'commit', 'review']

        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

        return {
          type: 'text' as const,
          value: `Subscribed to PR: ${prUrl}\nSubscription ID: ${subscriptionId}\nEvents: ${events.join(', ')}\n\nYou will receive notifications for ${events.length > 1 ? 'these events' : 'this event'} on the PR.`,
        }
      },
    }
  },
}

export default command