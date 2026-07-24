import { existsSync } from 'fs'
import { join } from 'path'
import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

// Builtin plugin: ecc (Every Claude Code)
// Importers: src/plugins/bundled/index.ts → registerEccPlugin()
// API: registerBuiltinPlugin(BuiltinPluginDefinition) — name, description, isAvailable, defaultEnabled
// ECC is 78MB marketplace with 278 skills — too large to embed in binary.
// Register as builtin plugin that auto-detects existing install at
// ~/.fusion-code/plugins/marketplaces/ecc/. If not present, available for install.
// User instruction: "测试一下git，ecc, UI-UX Pro Max三个skill能否默认打包在fusion-code中"
// Install path callers: plugin install flow reads ECC_REPO_URL for git clone

const ECC_REPO_URL = 'https://github.com/affaan-m/ECC.git'
const ECC_MARKETPLACE_DIR = 'ecc'

export function getEccInstallPath(): string {
    const configHome = getClaudeConfigHomeDir()
    return join(configHome, 'plugins', 'marketplaces', ECC_MARKETPLACE_DIR)
}

export function isEccInstalled(): boolean {
    return existsSync(join(getEccInstallPath(), '.claude-plugin', 'plugin.json'))
}

export { ECC_REPO_URL }

export function registerEccPlugin(): void {
    const installed = isEccInstalled()
    logForDebugging(
        `[Plugin:ecc] ECC marketplace ${installed ? 'found' : 'not found'} at ${getEccInstallPath()}`,
    )

    registerBuiltinPlugin({
        name: 'ecc',
        description:
            'Every Claude Code — 278 skills, 94 commands, hooks, and workflows for engineering teams. Auto-installs from GitHub on first use.',
        version: '2.0.0',
        isAvailable: () => isEccInstalled(),
        defaultEnabled: true,
    })
}
