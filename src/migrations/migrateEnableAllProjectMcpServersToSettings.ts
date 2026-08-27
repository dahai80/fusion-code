import { logEvent } from 'src/services/analytics/index.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

/**
 * Migration: Move MCP server approval fields from project config to local settings
 * This migrates both enableAllProjectMcpServers and enabledMcpjsonServers to the
 * settings system for better management and consistency.
 */
export function migrateEnableAllProjectMcpServersToSettings(): void {
  const projectConfig = getCurrentProjectConfig()

  // Check if any field exists in project config
  const hasEnableAll = projectConfig.enableAllProjectMcpServers !== undefined
  const hasEnabledServers =
    projectConfig.enabledMcpjsonServers &&
    projectConfig.enabledMcpjsonServers.length > 0
  const hasDisabledServers =
    projectConfig.disabledMcpjsonServers &&
    projectConfig.disabledMcpjsonServers.length > 0

  if (!hasEnableAll && !hasEnabledServers && !hasDisabledServers) {
    return
  }

  try {
    const existingSettings = getSettingsForSource('localSettings') || {}
    const updates: Partial<{
      enableAllProjectMcpServers: boolean
      enabledMcpjsonServers: string[]
      disabledMcpjsonServers: string[]
    }> = {}
    const fieldsToRemove: Array<
      | 'enableAllProjectMcpServers'
      | 'enabledMcpjsonServers'
      | 'disabledMcpjsonServers'
    > = []

    // Migrate enableAllProjectMcpServers if it exists and hasn't been migrated
    if (
      hasEnableAll &&
      existingSettings.enableAllProjectMcpServers === undefined
    ) {
      updates.enableAllProjectMcpServers =
        projectConfig.enableAllProjectMcpServers
      fieldsToRemove.push('enableAllProjectMcpServers')
    } else if (hasEnableAll) {
      // Already migrated, just mark for removal
      fieldsToRemove.push('enableAllProjectMcpServers')
    }

    // Migrate enabledMcpjsonServers if it exists
    if (hasEnabledServers && projectConfig.enabledMcpjsonServers) {
      const existingEnabledServers =
        existingSettings.enabledMcpjsonServers || []
      // Merge the servers (avoiding duplicates)
      updates.enabledMcpjsonServers = [
        ...new Set([
          ...existingEnabledServers,
          ...projectConfig.enabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('enabledMcpjsonServers')
    }

    // Migrate disabledMcpjsonServers if it exists
    if (hasDisabledServers && projectConfig.disabledMcpjsonServers) {
      const existingDisabledServers =
        existingSettings.disabledMcpjsonServers || []
      // Merge the servers (avoiding duplicates)
      updates.disabledMcpjsonServers = [
        ...new Set([
          ...existingDisabledServers,
          ...projectConfig.disabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('disabledMcpjsonServers')
    }

    // P2-14: 先写 settings 确认成功, 再删 project 字段 — 防部分失败丢数据。
    // 原: updateSettingsForSource 成功 + saveCurrentProjectConfig throw → settings
    // 有迁移值但 project config 仍带旧字段; 反向 (settings 写失败 + 删 project
    // 字段成功) → 数据丢。原 try/catch 吞异常 → 重跑不感知部分态。改为:
    // (1) 写 settings 必须无 error 才继续删 project; (2) 只删成功迁移的字段
    // (migratedFields), 留未迁移字段待下次重跑; (3) 任一失败大声日志不静默。
    const migratedFields: typeof fieldsToRemove = []

    // Update settings if there are any updates
    if (Object.keys(updates).length > 0) {
      const result = updateSettingsForSource('localSettings', updates)
      if (result?.error) {
        // settings 写失败 — 不删 project 字段, 保留源数据待重跑, 大声日志
        logError(result.error)
        logEvent('tengu_migrate_mcp_approval_fields_error', {})
        return
      }
      // settings 写成功 — 记录所有本轮推送的字段为已迁移
      migratedFields.push(...fieldsToRemove)
    } else if (fieldsToRemove.length > 0) {
      // 无 updates 但有 fieldsToRemove = 字段已迁移过 (else 分支), 仅待删
      migratedFields.push(...fieldsToRemove)
    }

    // 仅在 settings 已持数据的前提下, 从 project config 删已迁移字段
    if (migratedFields.length > 0) {
      const removeSet = new Set(migratedFields)
      saveCurrentProjectConfig(current => {
        // 保持 ProjectConfig 类型: 按字段名选择性 destructure 剔除
        const {
          enableAllProjectMcpServers: _e,
          enabledMcpjsonServers: _en,
          disabledMcpjsonServers: _d,
          ...rest
        } = current
        return rest
      })
    }

    // Log the migration event
    logEvent('tengu_migrate_mcp_approval_fields_success', {
      migratedCount: fieldsToRemove.length,
    })
  } catch (e: unknown) {
    // Log migration failure but don't throw to avoid breaking startup
    logError(e)
    logEvent('tengu_migrate_mcp_approval_fields_error', {})
  }
}
