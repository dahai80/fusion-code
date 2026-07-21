/**
 * Bash 命令死循环防护
 *
 * 拦截同一命令在三轮对话内被连续执行且输出完全一样的情况，
 * 抛出人工干预提示，防止本地小模型陷入命令执行死循环。
 */

/** 历史命令记录（command → 最近输出） */
const recentCommands: Array<{ command: string; output: string; timestamp: number }> = []
const MAX_HISTORY = 3
const DUPLICATE_THRESHOLD = 3

/** 记录并检查命令是否陷入死循环 */
export function checkCommandLoop(command: string, output: string): { shouldBlock: boolean; reason?: string } {
  // 清理超过 10 轮的旧记录
  const now = Date.now()
  while (recentCommands.length > 0 && now - recentCommands[0].timestamp > 60000) {
    recentCommands.shift()
  }

  // 统计相同命令 + 相同输出的次数
  const sameCommandSameOutput = recentCommands.filter(
    (entry) => entry.command === command && entry.output === output,
  )

  if (sameCommandSameOutput.length >= DUPLICATE_THRESHOLD) {
    return {
      shouldBlock: true,
      reason: `本地模型似乎陷入了命令执行死循环：命令 "${command}" 已连续 ${sameCommandSameOutput.length} 轮产生完全相同的输出。请手动介入检查。`,
    }
  }

  // 记录本次命令
  recentCommands.push({ command, output, timestamp: now })
  if (recentCommands.length > MAX_HISTORY * 2) {
    recentCommands.shift()
  }

  return { shouldBlock: false }
}

/** 清空历史记录（新一轮对话或 /clear 时调用） */
export function clearCommandLoopHistory(): void {
  recentCommands.length = 0
}
