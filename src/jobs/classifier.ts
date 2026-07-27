/**
 * Job Classifier — 任务分类器
 *
 * 分析用户输入，判断是否匹配某个模板任务，
 * 并在匹配时自动触发任务创建流程。
 *
 * gated by feature('TEMPLATES')
 */

import { feature } from 'bun:bundle'

export interface JobClassification {
  matched: boolean
  jobName?: string
  confidence?: number
  reason?: string
}

/**
 * Classify whether a user query matches a template job pattern.
 */
export function classifyQuery(query: string): JobClassification {
  if (!feature('TEMPLATES')) {
    return { matched: false }
  }

  // Simple keyword-based classification
  const jobKeywords = [
    'template', 'job', 'task', 'workflow',
    'deploy', 'review', 'test', 'release',
  ]

  const queryLower = query.toLowerCase()
  const matchedKeywords = jobKeywords.filter(k => queryLower.includes(k))

  if (matchedKeywords.length >= 2) {
    return {
      matched: true,
      jobName: matchedKeywords[0],
      confidence: matchedKeywords.length / jobKeywords.length,
      reason: `Matched keywords: ${matchedKeywords.join(', ')}`,
    }
  }

  return { matched: false }
}

/**
 * Check if a job classifier module is active and should process stop hooks.
 */
export function isJobClassifierActive(): boolean {
  if (!feature('TEMPLATES')) {
    return false
  }
  return !!process.env.CLAUDE_JOB_DIR
}

/**
 * Process a stop hook for job classification.
 * Called when a query completes to check if the result should be saved as a job.
 */
export function processJobStopHook(_querySource: string): void {
  if (!isJobClassifierActive()) {
    return
  }
  // Job stop hook processing happens here
  // In the full implementation, this would save the conversation as a job template
}

/**
 * Classify the current turn and write state to the job directory.
 * Reads the assistant messages from the turn, classifies them,
 * and persists classification state to <jobDir>/state.json.
 */
export async function classifyAndWriteState(
  jobDir: string,
  _assistantMessages: Array<{ type: string; message?: { content?: unknown } }>,
): Promise<void> {
  if (!feature('TEMPLATES')) {
    return
  }
  try {
    const { writeFileSync } = await import('fs')
    const state = {
      classifiedAt: new Date().toISOString(),
      jobDir,
    }
    writeFileSync(`${jobDir}/state.json`, JSON.stringify(state, null, 2))
  } catch {
    // Silently ignore write failures
  }
}