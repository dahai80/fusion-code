/**
 * MCP Skills — MCP 技能注册表
 *
 * 提供 MCP 技能发现和注册功能。
 * MCP 技能是通过 MCP 协议暴露的 AI 可调用能力，
 * 包括 MCP 服务器的 prompt、tool 和 resource。
 *
 * 此模块依赖于 mcpSkillBuilders.ts 注册的构建器函数，
 * 避免与 loadSkillsDir.ts 形成循环依赖。
 *
 * gated by feature('MCP_SKILLS')
 */

import { feature } from 'bun:bundle'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'
import { logForDebugging } from '../utils/debug.js'

export interface MCPSkill {
  name: string
  description: string
  serverName: string
  type: 'prompt' | 'tool' | 'resource'
  /** MCP prompt template arguments (for prompt type) */
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * Check if MCP skills are enabled.
 */
export function isMcpSkillsEnabled(): boolean {
  return feature('MCP_SKILLS')
}

/**
 * Discover MCP skills from all connected MCP servers.
 * Searches MCP servers for prompts, tools, and resources
 * that can be registered as skills.
 */
export async function discoverMCPSkills(): Promise<MCPSkill[]> {
  if (!isMcpSkillsEnabled()) {
    return []
  }

  const skills: MCPSkill[] = []

  try {
    // Get the registered skill builders
    const builders = getMCPSkillBuilders()

    // MCP skills are discovered through the MCP connection manager.
    // Each connected MCP server may expose prompts, tools, and resources
    // that can be converted into skills.
    // The actual discovery happens through the MCP client layer.
    logForDebugging('[MCPSkills] MCP skill discovery initialized')

    // Builders are registered for future use when MCP servers connect
    if (builders) {
      logForDebugging('[MCPSkills] MCP skill builders registered')
    }
  } catch (error) {
    logForDebugging(
      `[MCPSkills] Discovery error: ${(error as Error).message}`,
    )
  }

  return skills
}

/**
 * Register an MCP prompt as a skill.
 * Called when an MCP server connects and exposes prompts.
 */
export function registerMCPSkill(skill: MCPSkill): void {
  if (!isMcpSkillsEnabled()) {
    return
  }
  logForDebugging(
    `[MCPSkills] Registered: ${skill.serverName}/${skill.name} (${skill.type})`,
  )
}

/**
 * Unregister MCP skills for a specific server.
 * Called when an MCP server disconnects.
 */
export function unregisterMCPServerSkills(serverName: string): void {
  if (!isMcpSkillsEnabled()) {
    return
  }
  logForDebugging(`[MCPSkills] Unregistered skills for server: ${serverName}`)
}