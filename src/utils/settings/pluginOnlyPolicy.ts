import type { CUSTOMIZATION_SURFACES } from './types.js'

export type CustomizationSurface = (typeof CUSTOMIZATION_SURFACES)[number]

// #203 Phase B: settings.js imported lazily. The mcp barrel re-exports config,
// which imports this module; permissionValidation (also in the settings cone)
// consumes the barrel, forming settings→permissionValidation→barrel→config→
// pluginOnlyPolicy→settings. An eager settings import here re-enters settings.ts
// mid-init → isLoadingSettings TDZ. The read is at call time, so deferring the
// require is behavior-neutral (matches figures.ts's lazyRequire convention).
// #203 Phase B: settings.js imported lazily. The mcp barrel re-exports config,
// which imports this module; permissionValidation (also in the settings cone)
// consumes the barrel, forming settings→permissionValidation→barrel→config→
// pluginOnlyPolicy→settings. An eager settings import here re-enters settings.ts
// mid-init → isLoadingSettings TDZ. The read is at call time, so deferring the
// require is behavior-neutral. NOTE: bare require() (not createRequire) so Bun's
// bundler rewrites the static string literal into a bundle reference —
// createRequire(import.meta.url) resolves to the bundle root in `bun build
// --compile` and fails to find the in-bundle module (regression bcfdbfc).
type SettingsModule = typeof import('./settings.js')
let _settings: SettingsModule | null = null
function settings(): SettingsModule {
  if (_settings === null) {
    _settings = require('./settings.js')
  }
  return _settings
}

/**
 * Check whether a customization surface is locked to plugin-only sources
 * by the managed `strictPluginOnlyCustomization` policy.
 *
 * "Locked" means user-level (~/.claude/*) and project-level (.claude/*)
 * sources are skipped for that surface. Managed (policySettings) and
 * plugin-provided sources always load regardless — the policy is admin-set,
 * so managed sources are already admin-controlled, and plugins are gated
 * separately via `strictKnownMarketplaces`.
 *
 * `true` locks all four surfaces; array form locks only those listed.
 * Absent/undefined → nothing locked (the default).
 */
export function isRestrictedToPluginOnly(
  surface: CustomizationSurface,
): boolean {
  const policy =
    settings().getSettingsForSource('policySettings')?.strictPluginOnlyCustomization
  if (policy === true) return true
  if (Array.isArray(policy)) return policy.includes(surface)
  return false
}

/**
 * Sources that bypass strictPluginOnlyCustomization. Admin-trusted because:
 *   plugin — gated separately by strictKnownMarketplaces
 *   policySettings — from managed settings, admin-controlled by definition
 *   built-in / builtin / bundled — ship with the CLI, not user-authored
 *
 * Everything else (userSettings, projectSettings, localSettings, flagSettings,
 * mcp, undefined) is user-controlled and blocked when the relevant surface
 * is locked. Covers both AgentDefinition.source ('built-in' with hyphen) and
 * Command.source ('builtin' no hyphen, plus 'bundled').
 */
const ADMIN_TRUSTED_SOURCES: ReadonlySet<string> = new Set([
  'plugin',
  'policySettings',
  'built-in',
  'builtin',
  'bundled',
])

/**
 * Whether a customization's source is admin-trusted under
 * strictPluginOnlyCustomization. Use this to gate frontmatter-hook
 * registration and similar per-item checks where the item carries a
 * source tag but the surface's filesystem loader already ran.
 *
 * Pattern at call sites:
 *   const allowed = !isRestrictedToPluginOnly(surface) || isSourceAdminTrusted(item.source)
 *   if (item.hooks && allowed) { register(...) }
 */
export function isSourceAdminTrusted(source: string | undefined): boolean {
  return source !== undefined && ADMIN_TRUSTED_SOURCES.has(source)
}
