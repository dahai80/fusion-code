/**
 * Coordinator Worker Agent — 协调器工作 Agent
 *
 * 在协调器模式下，系统使用多个工作 Agent 来并行处理任务。
 * 协调器负责分配任务、收集结果、汇总输出。
 *
 * gated by feature('COORDINATOR_MODE')
 */

import { feature } from 'bun:bundle'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

const COORDINATOR_AGENT_TYPE = 'coordinator'

export interface CoordinatorWorkerConfig {
  workerCount: number
  maxTurnsPerWorker: number
  allowedTools: string[]
}

/**
 * Get the list of coordinator agents.
 * Called by builtInAgents.ts when COORDINATOR_MODE is enabled.
 */
export function getCoordinatorAgents(): AgentDefinition[] {
  if (!feature('COORDINATOR_MODE')) {
    return []
  }

  return [
    COORDINATOR_MAIN_AGENT,
    COORDINATOR_WORKER_AGENT,
  ]
}

/**
 * Coordinator agent tool allowlist — tools that coordinator agents can use.
 */
const COORDINATOR_ALLOWED_TOOLS = [
  BASH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_READ_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
]

/**
 * Main coordinator agent — orchestrates tasks across workers.
 */
const COORDINATOR_MAIN_AGENT: AgentDefinition = {
  agentType: 'coordinator',
  source: 'built-in',
  name: 'Coordinator',
  whenToUse: 'Coordinate multi-agent workflows',
  getSystemPrompt: () => `You are the Coordinator agent. Your role is to:
1. Analyze the user's request and break it down into subtasks
2. Delegate subtasks to worker agents
3. Collect and synthesize results
4. Present the final output to the user

You can use the Agent tool to spawn worker agents for parallel execution.
Each worker has access to: Bash, FileRead, FileEdit, Glob, Grep tools.

Coordinate efficiently: group related work, avoid redundant operations,
and ensure workers have clear, self-contained instructions.`,
  allowedTools: [AGENT_TOOL_NAME, ...COORDINATOR_ALLOWED_TOOLS],
  maxTurns: 50,
  userFacingName: () => 'Coordinator',
}

/**
 * Worker agent — executes delegated subtasks.
 */
const COORDINATOR_WORKER_AGENT: AgentDefinition = {
  agentType: 'coordinator-worker',
  source: 'built-in',
  name: 'Coordinator Worker',
  whenToUse: 'Execute delegated subtasks',
  getSystemPrompt: () => `You are a Coordinator Worker agent. You have been assigned a specific subtask by the Coordinator.

Focus on your assigned task and complete it efficiently.
Report your findings clearly so the Coordinator can synthesize the results.

Available tools: Bash, FileRead, FileEdit, Glob, Grep.`,
  allowedTools: COORDINATOR_ALLOWED_TOOLS,
  maxTurns: 30,
  userFacingName: () => 'Worker',
}

/**
 * Check if coordinator mode is active based on environment.
 */
export function isCoordinatorModeActive(): boolean {
  if (!feature('COORDINATOR_MODE')) {
    return false
  }
  const { isEnvTruthy } = require('../utils/envUtils.js')
  return isEnvTruthy(process.env.FUSION_CODE_COORDINATOR_MODE)
}

export { COORDINATOR_AGENT_TYPE }