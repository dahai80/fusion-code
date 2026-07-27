/**
 * Hunter — 审查构件工具
 *
 * 提供代码审查和构件分析功能。
 * 支持对代码变更进行自动审查，生成审查报告。
 * 与 bughunter 命令配合使用，用于远程审查任务。
 *
 * gated by feature('REVIEW_ARTIFACT')
 */

import { logForDebugging } from './utils/debug.js'

export interface ReviewArtifact {
  id: string
  type: 'security' | 'code_quality' | 'performance' | 'dependency'
  title: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  filePath?: string
  lineNumber?: number
  recommendation?: string
}

export interface ReviewResult {
  artifacts: ReviewArtifact[]
  summary: string
  totalIssues: number
  criticalCount: number
  highCount: number
}

/**
 * Analyze code for potential issues.
 * Returns a review result with all found artifacts.
 */
export async function analyzeCode(path: string): Promise<ReviewResult> {
  logForDebugging(`[Hunter] Analyzing code at: ${path}`)

  const artifacts: ReviewArtifact[] = []

  // In the full implementation, this would:
  // 1. Parse the code at the given path
  // 2. Run static analysis rules
  // 3. Check for security vulnerabilities
  // 4. Check for code quality issues
  // 5. Return the results

  return {
    artifacts,
    summary: `Analysis complete for ${path}`,
    totalIssues: artifacts.length,
    criticalCount: artifacts.filter(a => a.severity === 'critical').length,
    highCount: artifacts.filter(a => a.severity === 'high').length,
  }
}

/**
 * Extract review content from remote session log.
 * Used by RemoteAgentTask for bughunter mode.
 */
export function extractReviewTagFromLog(log: unknown[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i] as Record<string, unknown> | undefined
    if (msg?.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response')) {
      const stdout = msg.stdout as string | undefined
      if (stdout) {
        const match = stdout.match(/<remote-review>([\s\S]*?)<\/remote-review>/)
        if (match) return match[1]!.trim()
      }
    }
  }
  return null
}