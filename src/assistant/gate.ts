/**
 * KAIROS Gate — 助理模式门控
 *
 * 控制助理模式的启用/禁用状态。
 * 通过 GrowthBook 特性标志和环境变量进行门控。
 *
 * gated by feature('KAIROS')
 */

import { feature } from 'bun:bundle'
import { isEnvTruthy } from '../utils/envUtils.js'

/**
 * Check if the KAIROS gate is open (assistant mode is allowed).
 * Returns true if KAIROS is enabled via feature flag or env var.
 */
export function isKairosGateOpen(): boolean {
  if (!feature('KAIROS')) return false
  // Allow env var override for testing
  if (isEnvTruthy(process.env.FUSION_CODE_KAIROS_ENABLED)) return true
  return true // Gate is open when feature flag is present
}

/**
 * Check if the assistant mode entitlement is active.
 * More restrictive than isKairosGateOpen — checks runtime conditions.
 */
export function isAssistantEntitled(): boolean {
  if (!isKairosGateOpen()) return false
  // Check entitlement conditions
  // In the full implementation, this checks GrowthBook + subscription status
  return true
}

/**
 * Get the assistant mode scope.
 * Returns the scope of assistant mode (e.g., "team", "single", "viewer").
 */
export function getAssistantScope(): 'team' | 'single' | 'viewer' {
  if (!isKairosGateOpen()) return 'single'

  if (isEnvTruthy(process.env.FUSION_CODE_ASSISTANT_TEAM_MODE)) {
    return 'team'
  }
  if (isEnvTruthy(process.env.FUSION_CODE_ASSISTANT_VIEWER_MODE)) {
    return 'viewer'
  }
  return 'single'
}