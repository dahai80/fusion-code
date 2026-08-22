import { execa } from 'execa'
import { readFile, realpath } from 'fs/promises'
import { homedir } from 'os'
import { delimiter, join, posix, win32 } from 'path'
import { checkGlobalInstallPermissions } from './autoUpdater.js'
import { isInBundledMode } from './bundledMode.js'
import {
  formatAutoUpdaterDisabledReason,
  getAutoUpdaterDisabledReason,
  getGlobalConfig,
  type InstallMethod,
} from './config.js'
import { getCwd } from './cwd.js'
import { isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  getShellType,
  isRunningFromLocalInstallation,
  localInstallationExists,
} from './localInstaller.js'
import {
  detectApk,
  detectAsdf,
  detectDeb,
  detectHomebrew,
  detectMise,
  detectPacman,
  detectRpm,
  detectWinget,
  getPackageManager,
} from './nativeInstaller/packageManagers.js'
import { shouldAutoUseFusionMlx } from './model/providers.js'
import { getPlatform } from './platform.js'
import { getRipgrepStatus } from './ripgrep.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { getManagedFilePath } from './settings/managedPath.js'
import { CUSTOMIZATION_SURFACES } from './settings/types.js'
import {
  findClaudeAlias,
  findValidClaudeAlias,
  getShellConfigPaths,
} from './shellConfig.js'
import { jsonParse } from './slowOperations.js'
import { which } from './which.js'
import {
  fetchMlxPs,
  fetchMlxStatus,
} from '../commands/model-status/model-status.js'
import { fetchMlxHealth, requestMlxGC } from '../services/api/fusion-mlx-adapter.js'

export type InstallationType =
  | 'npm-global'
  | 'npm-local'
  | 'native'
  | 'package-manager'
  | 'development'
  | 'unknown'

export type DiagnosticInfo = {
  installationType: InstallationType
  version: string
  installationPath: string
  invokedBinary: string
  configInstallMethod: InstallMethod | 'not set'
  autoUpdates: string
  hasUpdatePermissions: boolean | null
  multipleInstallations: Array<{ type: string; path: string }>
  warnings: Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }>
  recommendation?: string
  packageManager?: string
  ripgrepStatus: {
    working: boolean
    mode: 'system' | 'builtin' | 'embedded'
    systemPath: string | null
  }
}

function getNormalizedPaths(): [invokedPath: string, execPath: string] {
  let invokedPath = process.argv[1] || ''
  let execPath = process.execPath || process.argv[0] || ''

  // On Windows, convert backslashes to forward slashes for consistent path matching
  if (getPlatform() === 'windows') {
    invokedPath = invokedPath.split(win32.sep).join(posix.sep)
    execPath = execPath.split(win32.sep).join(posix.sep)
  }

  return [invokedPath, execPath]
}

export async function getCurrentInstallationType(): Promise<InstallationType> {
  if (process.env.NODE_ENV === 'development') {
    return 'development'
  }

  const [invokedPath] = getNormalizedPaths()

  // Check if running in bundled mode first
  if (isInBundledMode()) {
    // Check if this bundled instance was installed by a package manager
    if (
      detectHomebrew() ||
      detectWinget() ||
      detectMise() ||
      detectAsdf() ||
      (await detectPacman()) ||
      (await detectDeb()) ||
      (await detectRpm()) ||
      (await detectApk())
    ) {
      return 'package-manager'
    }
    return 'native'
  }

  // Check if running from local npm installation
  if (isRunningFromLocalInstallation()) {
    return 'npm-local'
  }

  // Check if we're in a typical npm global location
  const npmGlobalPaths = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/.nvm/versions/node/', // nvm installations
  ]

  if (npmGlobalPaths.some(path => invokedPath.includes(path))) {
    return 'npm-global'
  }

  // Also check for npm/nvm in the path even if not in standard locations
  if (invokedPath.includes('/npm/') || invokedPath.includes('/nvm/')) {
    return 'npm-global'
  }

  const npmConfigResult = await execa('npm config get prefix', {
    shell: true,
    reject: false,
  })
  const globalPrefix =
    npmConfigResult.exitCode === 0 ? npmConfigResult.stdout.trim() : null

  if (globalPrefix && invokedPath.startsWith(globalPrefix)) {
    return 'npm-global'
  }

  // If we can't determine, return unknown
  return 'unknown'
}

async function getInstallationPath(): Promise<string> {
  if (process.env.NODE_ENV === 'development') {
    return getCwd()
  }

  // For bundled/native builds, show the binary location
  if (isInBundledMode()) {
    // Try to find the actual binary that was invoked
    try {
      return await realpath(process.execPath)
    } catch {
      // This function doesn't expect errors
    }

    try {
      const path = await which('claude')
      if (path) {
        return path
      }
    } catch {
      // This function doesn't expect errors
    }

    // If we can't find it, check common locations
    try {
      await getFsImplementation().stat(join(homedir(), '.local/bin/claude'))
      return join(homedir(), '.local/bin/claude')
    } catch {
      // Not found
    }
    return 'native'
  }

  // For npm installations, use the path of the executable
  try {
    return process.argv[0] || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function getInvokedBinary(): string {
  try {
    // For bundled/compiled executables, show the actual binary path
    if (isInBundledMode()) {
      return process.execPath || 'unknown'
    }

    // For npm/development, show the script path
    return process.argv[1] || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function detectMultipleInstallations(): Promise<
  Array<{ type: string; path: string }>
> {
  const fs = getFsImplementation()
  const installations: Array<{ type: string; path: string }> = []

  // Check for local installation
  const localPath = join(homedir(), '.fusion-code', 'local')
  if (await localInstallationExists()) {
    installations.push({ type: 'npm-local', path: localPath })
  }

  // Check for global npm installation
  const packagesToCheck = ['@anthropic-ai/claude-code']
  if (MACRO.PACKAGE_URL && MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code') {
    packagesToCheck.push(MACRO.PACKAGE_URL)
  }
  const npmResult = await execFileNoThrow('npm', [
    '-g',
    'config',
    'get',
    'prefix',
  ])
  if (npmResult.code === 0 && npmResult.stdout) {
    const npmPrefix = npmResult.stdout.trim()
    const isWindows = getPlatform() === 'windows'

    // First check for active installations via bin/claude
    // Linux / macOS have prefix/bin/claude and prefix/lib/node_modules
    // Windows has prefix/claude and prefix/node_modules
    const globalBinPath = isWindows
      ? join(npmPrefix, 'claude')
      : join(npmPrefix, 'bin', 'claude')

    let globalBinExists = false
    try {
      await fs.stat(globalBinPath)
      globalBinExists = true
    } catch {
      // Not found
    }

    if (globalBinExists) {
      // Check if this is actually a Homebrew cask installation, not npm-global
      // When npm is installed via Homebrew, both can exist at /opt/homebrew/bin/claude
      // We need to resolve the symlink to see where it actually points
      let isCurrentHomebrewInstallation = false

      try {
        // Resolve the symlink to get the actual target
        const realPath = await realpath(globalBinPath)

        // If the symlink points to a Caskroom directory, it's a Homebrew cask
        // Only skip it if it's the same Homebrew installation we're currently running from
        if (realPath.includes('/Caskroom/')) {
          isCurrentHomebrewInstallation = detectHomebrew()
        }
      } catch {
        // If we can't resolve the symlink, include it anyway
      }

      if (!isCurrentHomebrewInstallation) {
        installations.push({ type: 'npm-global', path: globalBinPath })
      }
    } else {
      // If no bin/claude exists, check for orphaned packages (no bin/claude symlink)
      for (const packageName of packagesToCheck) {
        const globalPackagePath = isWindows
          ? join(npmPrefix, 'node_modules', packageName)
          : join(npmPrefix, 'lib', 'node_modules', packageName)

        try {
          await fs.stat(globalPackagePath)
          installations.push({
            type: 'npm-global-orphan',
            path: globalPackagePath,
          })
        } catch {
          // Package not found
        }
      }
    }
  }

  // Check for native installation

  // Check common native installation paths
  const nativeBinPath = join(homedir(), '.local', 'bin', 'claude')
  try {
    await fs.stat(nativeBinPath)
    installations.push({ type: 'native', path: nativeBinPath })
  } catch {
    // Not found
  }

  // Also check if config indicates native installation
  const config = getGlobalConfig()
  if (config.installMethod === 'native') {
    const nativeDataPath = join(homedir(), '.local', 'share', 'claude')
    try {
      await fs.stat(nativeDataPath)
      if (!installations.some(i => i.type === 'native')) {
        installations.push({ type: 'native', path: nativeDataPath })
      }
    } catch {
      // Not found
    }
  }

  return installations
}

// FUSION_* -> ANTHROPIC_* env mapping pairs (cli.tsx:30-49). Each pair uses
// `if (FUSION_X && !ANTHROPIC_X) ANTHROPIC_X = FUSION_X` — so when BOTH are
// set the FUSION_* value is silently ignored. That's the P4.2 spec "残留陷阱":
// a user sets FUSION_BASE_URL expecting it to take effect, but a leftover
// ANTHROPIC_BASE_URL shadows it with no warning. Surfaced in /doctor so the
// shadowing is visible rather than silent.
const FUSION_ENV_CONFLICT_PAIRS: ReadonlyArray<{
  fusion: string
  anthropic: string
}> = [
  { fusion: 'FUSION_API_KEY', anthropic: 'ANTHROPIC_API_KEY' },
  { fusion: 'FUSION_BASE_URL', anthropic: 'ANTHROPIC_BASE_URL' },
  { fusion: 'FUSION_AUTH_TOKEN', anthropic: 'ANTHROPIC_AUTH_TOKEN' },
  { fusion: 'FUSION_BETAS', anthropic: 'ANTHROPIC_BETAS' },
  { fusion: 'FUSION_MODEL', anthropic: 'ANTHROPIC_MODEL' },
  { fusion: 'FUSION_LOG', anthropic: 'ANTHROPIC_LOG' },
]

export function detectFusionEnvConflicts(): Array<{
  issue: string
  fix: string
  fixAction?: () => Promise<unknown>
}> {
  const warnings: Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }> = []
  for (const { fusion, anthropic } of FUSION_ENV_CONFLICT_PAIRS) {
    if (process.env[fusion] && process.env[anthropic]) {
      warnings.push({
        issue: `Both ${fusion} and ${anthropic} are set; ${fusion} is silently ignored (the ${anthropic} value takes precedence).`,
        fix: `Unset the one you don't intend to use, e.g. \`unset ${anthropic}\`, or align them to the same value. Only ${anthropic} is read when both are present.`,
      })
    }
  }
  return warnings
}

async function detectConfigurationIssues(
  type: InstallationType,
): Promise<Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }>> {
  const warnings: Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }> = []
  // P4.2 §6: FUSION_* vs ANTHROPIC_* env-conflict detection. Runs before the
  // development-mode early return below — env correctness is relevant in dev
  // too, and this check is pure sync (no install-path dependency).
  warnings.push(...detectFusionEnvConflicts())

  // Managed-settings forwards-compat: the schema preprocess silently drops
  // unknown strictPluginOnlyCustomization surface names so one future enum
  // value doesn't null out the entire policy file (settings.ts:101). But
  // admins should KNOW — read the raw file and diff. Runs before the
  // development-mode early return: this is config correctness, not an
  // install-path check, and it's useful to see during dev testing.
  try {
    const raw = await readFile(
      join(getManagedFilePath(), 'managed-settings.json'),
      'utf-8',
    )
    const parsed: unknown = jsonParse(raw)
    const field =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).strictPluginOnlyCustomization
        : undefined
    if (field !== undefined && typeof field !== 'boolean') {
      if (!Array.isArray(field)) {
        // .catch(undefined) in the schema silently drops this, so the rest
        // of managed settings survive — but the admin typed something
        // wrong (an object, a string, etc.).
        warnings.push({
          issue: `managed-settings.json: strictPluginOnlyCustomization has an invalid value (expected true or an array, got ${typeof field})`,
          fix: `The field is silently ignored (schema .catch rescues it). Set it to true, or an array of: ${CUSTOMIZATION_SURFACES.join(', ')}.`,
        })
      } else {
        const unknown = field.filter(
          x =>
            typeof x === 'string' &&
            !(CUSTOMIZATION_SURFACES as readonly string[]).includes(x),
        )
        if (unknown.length > 0) {
          warnings.push({
            issue: `managed-settings.json: strictPluginOnlyCustomization has ${unknown.length} value(s) this client doesn't recognize: ${unknown.map(String).join(', ')}`,
            fix: `These are silently ignored (forwards-compat). Known surfaces for this version: ${CUSTOMIZATION_SURFACES.join(', ')}. Either remove them, or this client is older than the managed-settings intended.`,
          })
        }
      }
    }
  } catch {
    // ENOENT (no managed settings) / parse error — not this check's concern.
    // Parse errors are surfaced by the settings loader itself.
  }

  const config = getGlobalConfig()

  // Skip most warnings for development mode
  if (type === 'development') {
    return warnings
  }

  // Check if ~/.local/bin is in PATH for native installations
  if (type === 'native') {
    const path = process.env.PATH || ''
    const pathDirectories = path.split(delimiter)
    const homeDir = homedir()
    const localBinPath = join(homeDir, '.local', 'bin')

    // On Windows, convert backslashes to forward slashes for consistent path matching
    let normalizedLocalBinPath = localBinPath
    if (getPlatform() === 'windows') {
      normalizedLocalBinPath = localBinPath.split(win32.sep).join(posix.sep)
    }

    // Check if ~/.local/bin is in PATH (handle both expanded and unexpanded forms)
    // Also handle trailing slashes that users may have in their PATH
    const localBinInPath = pathDirectories.some(dir => {
      let normalizedDir = dir
      if (getPlatform() === 'windows') {
        normalizedDir = dir.split(win32.sep).join(posix.sep)
      }
      // Remove trailing slashes for comparison (handles paths like /home/user/.local/bin/)
      const trimmedDir = normalizedDir.replace(/\/+$/, '')
      const trimmedRawDir = dir.replace(/[/\\]+$/, '')
      return (
        trimmedDir === normalizedLocalBinPath ||
        trimmedRawDir === '~/.local/bin' ||
        trimmedRawDir === '$HOME/.local/bin'
      )
    })

    if (!localBinInPath) {
      const isWindows = getPlatform() === 'windows'
      if (isWindows) {
        // Windows-specific PATH instructions
        const windowsLocalBinPath = localBinPath
          .split(posix.sep)
          .join(win32.sep)
        warnings.push({
          issue: `Native installation exists but ${windowsLocalBinPath} is not in your PATH`,
          fix: `Add it by opening: System Properties → Environment Variables → Edit User PATH → New → Add the path above. Then restart your terminal.`,
        })
      } else {
        // Unix-style PATH instructions
        const shellType = getShellType()
        const configPaths = getShellConfigPaths()
        const configFile = configPaths[shellType as keyof typeof configPaths]
        const displayPath = configFile
          ? configFile.replace(homedir(), '~')
          : 'your shell config file'

        warnings.push({
          issue:
            'Native installation exists but ~/.local/bin is not in your PATH',
          fix: `Run: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${displayPath} then open a new terminal or run: source ${displayPath}`,
        })
      }
    }
  }

  // Check for configuration mismatches
  // Skip these checks if DISABLE_INSTALLATION_CHECKS is set (e.g., in HFI)
  if (!isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    if (type === 'npm-local' && config.installMethod !== 'local') {
      warnings.push({
        issue: `Running from local installation but config install method is '${config.installMethod}'`,
        fix: 'Consider using native installation: claude install',
      })
    }

    if (type === 'native' && config.installMethod !== 'native') {
      warnings.push({
        issue: `Running native installation but config install method is '${config.installMethod}'`,
        fix: 'Run claude install to update configuration',
      })
    }
  }

  if (type === 'npm-global' && (await localInstallationExists())) {
    warnings.push({
      issue: 'Local installation exists but not being used',
      fix: 'Consider using native installation: claude install',
    })
  }

  const existingAlias = await findClaudeAlias()
  const validAlias = await findValidClaudeAlias()

  // Check if running local installation but it's not in PATH
  if (type === 'npm-local') {
    // Check if claude is already accessible via PATH
    const whichResult = await which('claude')
    const claudeInPath = !!whichResult

    // Only show warning if claude is NOT in PATH AND no valid alias exists
    if (!claudeInPath && !validAlias) {
      if (existingAlias) {
        // Alias exists but points to invalid target
        warnings.push({
          issue: 'Local installation not accessible',
          fix: `Alias exists but points to invalid target: ${existingAlias}. Update alias: alias claude="~/.claude/local/claude"`,
        })
      } else {
        // No alias exists and not in PATH
        warnings.push({
          issue: 'Local installation not accessible',
          fix: 'Create alias: alias claude="~/.claude/local/claude"',
        })
      }
    }
  }

  return warnings
}

export function detectLinuxGlobPatternWarnings(): Array<{
  issue: string
  fix: string
  fixAction?: () => Promise<unknown>
}> {
  if (getPlatform() !== 'linux') {
    return []
  }

  const warnings: Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }> = []
  const globPatterns = SandboxManager.getLinuxGlobPatternWarnings()

  if (globPatterns.length > 0) {
    // Show first 3 patterns, then indicate if there are more
    const displayPatterns = globPatterns.slice(0, 3).join(', ')
    const remaining = globPatterns.length - 3
    const patternList =
      remaining > 0 ? `${displayPatterns} (${remaining} more)` : displayPatterns

    warnings.push({
      issue: `Glob patterns in sandbox permission rules are not fully supported on Linux`,
      fix: `Found ${globPatterns.length} pattern(s): ${patternList}. On Linux, glob patterns in Edit/Read rules will be ignored.`,
    })
  }

  return warnings
}

// MLX gateway base URL. Keep in sync with model-status.ts:3 — fetchMlxStatus
// resolves the same expression internally but does not surface the URL in its
// return value, so we recompute it here for the not-reachable error message.
const MLX_GATEWAY_URL =
  process.env.FUSION_GATEWAY_URL ||
  process.env.FUSION_MLX_BASE_URL ||
  'http://127.0.0.1:11432'

// P4.2 #1+#3+#4: probe MLX gateway reachability + model-load state + OOM.
// Only when MLX is the configured provider (shouldAutoUseFusionMlx) —
// otherwise MLX being down is expected (cloud active) and probing wastes a
// 3s timeout + noise. Reuses fetchMlxStatus/fetchMlxPs (same /api/tags +
// /api/ps the `/model-status` command uses, 3s timeout cap). OOM (#4) via
// fetchMlxHealth (GET /v1/health, fusion-mlx#564/PR #581) — only probed after
// a model is loaded (no point probing memory when nothing occupies it). That
// endpoint is management-gated (valid api_key required, loopback not exempt
// per fusion-mlx#350); single-box anonymous MLX deployments have no management
// access → fetchMlxHealth returns null (fail-open) → OOM diagnostics silently
// skip rather than false-positive. oom_risk is a deterministic two-signal
// classifier (available_ratio + mlx_peak_ratio) computed by fusion-mlx.
function formatBytesLocal(bytes: number): string {
  if (!bytes) return '0B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)}${units[i]}`
}

export async function detectMlxHealth(): Promise<
  Array<{ issue: string; fix: string; fixAction?: () => Promise<unknown> }>
> {
  if (!shouldAutoUseFusionMlx()) {
    return []
  }

  const status = await fetchMlxStatus()
  if (!status.connected) {
    return [
      {
        issue: `Fusion-MLX gateway not reachable at ${MLX_GATEWAY_URL} (${status.error ?? 'connection refused'}). Local inference unavailable.`,
        fix: 'Start MLX with `fusion service start mlx` (or `~/claude-home/fusion-mlx/start.sh start`). Set FUSION_GATEWAY_URL to override, or FUSION_MLX_DISABLED=1 to disable.',
      },
    ]
  }

  const loaded = await fetchMlxPs()
  if (loaded.length === 0) {
    const available = status.models.map((m) => m.name)
    const availableSuffix =
      available.length > 0
        ? ` (available: ${available.slice(0, 3).join(', ')}${available.length > 3 ? '…' : ''})`
        : ''
    return [
      {
        issue: `Fusion-MLX gateway connected but no model loaded${availableSuffix}. Queries will trigger a cold load (slow first turn).`,
        fix:
          available.length > 0
            ? `Pre-load a model, e.g. \`fusion model load ${available[0]}\`, or just start querying — MLX lazy-loads on first request.`
            : 'No models found. Download one via the model hub, then load it.',
      },
    ]
  }

  // P4.2 #4: proactive OOM detection (fusion-mlx#564). Only when a model is
  // loaded — no point probing memory when nothing occupies it. fetchMlxHealth
  // is management-gated (401 → null fail-open): single-box anonymous MLX
  // deployments have no management access, so OOM diagnostics silently skip
  // rather than false-positive.
  const health = await fetchMlxHealth()
  if (health?.oom_risk === 'imminent') {
    return [
      {
        issue: `Fusion-MLX memory OOM imminent (oom_risk=imminent). Next large request will likely crash.${health.memory ? ` Available ${formatBytesLocal(health.memory.free_bytes)} / ${formatBytesLocal(health.memory.total_bytes)}, MLX peak ${formatBytesLocal(health.memory.mlx_peak_bytes ?? 0)}.` : ''}`,
        fix: 'Run `/mlx gc` (or POST /api/v1/gc) to reclaim MLX cache, or unload the oldest model with `fusion model unload <name>` to free memory before the next request.',
        fixAction: requestMlxGC,
      },
    ]
  }
  if (health?.oom_risk === 'high') {
    return [
      {
        issue: `Fusion-MLX memory pressure high (oom_risk=high). Performance may degrade; large requests risk OOM.${health.memory ? ` Available ${formatBytesLocal(health.memory.free_bytes)} / ${formatBytesLocal(health.memory.total_bytes)}.` : ''}`,
        fix: 'Run `/mlx gc` to reclaim MLX cache, or unload unused models to reduce memory pressure.',
        fixAction: requestMlxGC,
      },
    ]
  }

  return []
}

export async function getDoctorDiagnostic(): Promise<DiagnosticInfo> {
  const installationType = await getCurrentInstallationType()
  const version =
    typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : 'unknown'
  const installationPath = await getInstallationPath()
  const invokedBinary = getInvokedBinary()
  const multipleInstallations = await detectMultipleInstallations()
  const warnings = await detectConfigurationIssues(installationType)

  // Add glob pattern warnings for Linux sandboxing
  warnings.push(...detectLinuxGlobPatternWarnings())

  // P4.2 #1+#3: MLX gateway reachability + model-load state (only when MLX is
  // the configured provider). Runtime health, distinct from config correctness
  // — runs regardless of dev mode (MLX availability matters in dev too).
  warnings.push(...(await detectMlxHealth()))

  // Add warnings for leftover npm installations when running native
  if (installationType === 'native') {
    const npmInstalls = multipleInstallations.filter(
      i =>
        i.type === 'npm-global' ||
        i.type === 'npm-global-orphan' ||
        i.type === 'npm-local',
    )

    const isWindows = getPlatform() === 'windows'

    for (const install of npmInstalls) {
      if (install.type === 'npm-global') {
        let uninstallCmd = 'npm -g uninstall @anthropic-ai/claude-code'
        if (
          MACRO.PACKAGE_URL &&
          MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code'
        ) {
          uninstallCmd += ` && npm -g uninstall ${MACRO.PACKAGE_URL}`
        }
        warnings.push({
          issue: `Leftover npm global installation at ${install.path}`,
          fix: `Run: ${uninstallCmd}`,
        })
      } else if (install.type === 'npm-global-orphan') {
        warnings.push({
          issue: `Orphaned npm global package at ${install.path}`,
          fix: isWindows
            ? `Run: rmdir /s /q "${install.path}"`
            : `Run: rm -rf ${install.path}`,
        })
      } else if (install.type === 'npm-local') {
        warnings.push({
          issue: `Leftover npm local installation at ${install.path}`,
          fix: isWindows
            ? `Run: rmdir /s /q "${install.path}"`
            : `Run: rm -rf ${install.path}`,
        })
      }
    }
  }

  const config = getGlobalConfig()

  // Get config values for display
  const configInstallMethod = config.installMethod || 'not set'

  // Check permissions for global installations
  let hasUpdatePermissions: boolean | null = null
  if (installationType === 'npm-global') {
    const permCheck = await checkGlobalInstallPermissions()
    hasUpdatePermissions = permCheck.hasPermissions

    // Add warning if no permissions
    if (!hasUpdatePermissions && !getAutoUpdaterDisabledReason()) {
      warnings.push({
        issue: 'Insufficient permissions for auto-updates',
        fix: 'Do one of: (1) Re-install node without sudo, or (2) Use `claude install` for native installation',
      })
    }
  }

  // Get ripgrep status and configuration
  const ripgrepStatusRaw = getRipgrepStatus()

  // Provide simple ripgrep status info
  const ripgrepStatus = {
    working: ripgrepStatusRaw.working ?? true, // Assume working if not yet tested
    mode: ripgrepStatusRaw.mode,
    systemPath:
      ripgrepStatusRaw.mode === 'system' ? ripgrepStatusRaw.path : null,
  }

  // Get package manager info if running from package manager
  const packageManager =
    installationType === 'package-manager'
      ? await getPackageManager()
      : undefined

  const diagnostic: DiagnosticInfo = {
    installationType,
    version,
    installationPath,
    invokedBinary,
    configInstallMethod,
    autoUpdates: (() => {
      const reason = getAutoUpdaterDisabledReason()
      return reason
        ? `disabled (${formatAutoUpdaterDisabledReason(reason)})`
        : 'enabled'
    })(),
    hasUpdatePermissions,
    multipleInstallations,
    warnings,
    packageManager,
    ripgrepStatus,
  }

  return diagnostic
}
