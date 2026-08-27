import chalk from 'chalk'
import type { Command, LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js'
import { getBuiltinPlugins } from '../../plugins/builtinPlugins.js'
import { discoverPlugins, parseDiscoverArgs } from './discover.js'

const call: LocalCommandCall = async (args, context) => {
    try {
        const trimmed = args.trim()
        if (trimmed === 'list' || trimmed === '') {
            return listPlugins()
        }
        if (trimmed === 'preview' || trimmed.startsWith('preview ')) {
            const pluginName = trimmed.replace(/^preview\s+/, '').trim()
            return previewPlugin(pluginName)
        }
        if (trimmed === 'discover' || trimmed.startsWith('discover ')) {
            const opts = parseDiscoverArgs(trimmed.replace(/^discover\s+/, '').trim())
            return await discoverPlugins(opts)
        }
        if (trimmed === 'update') {
            return { type: 'text', value: 'No installed plugins need updates. Use /plugins to list installed.' }
        }
        return { type: 'text', value: 'Usage: /plugins [list|preview <name>|discover [query]|update]' }
    } catch (err) {
        logForDebugging(`[plugins] Error: ${(err as Error).message}`)
        return { type: 'text', value: `Failed: ${(err as Error).message}` }
    }
}

function listPlugins(): { type: 'text'; value: string } {
    const pluginsFile = loadInstalledPluginsV2()
    const entries = pluginsFile.plugins

    const allEntries: Array<{
        id: string
        scope: string
        version: string | undefined
        installedAt: string | undefined
        installPath: string
    }> = []

    for (const [pluginId, installations] of Object.entries(entries)) {
        for (const inst of installations) {
            allEntries.push({
                id: pluginId,
                scope: inst.scope,
                version: inst.version,
                installedAt: inst.installedAt,
                installPath: inst.installPath,
            })
        }
    }

    const { enabled, disabled } = getBuiltinPlugins()
    for (const p of [...enabled, ...disabled]) {
        const pluginId = `${p.name}@builtin`
        if (!allEntries.some(e => e.id === pluginId)) {
            allEntries.push({
                id: pluginId,
                scope: 'builtin',
                version: p.manifest.version,
                installedAt: undefined,
                installPath: p.path,
            })
        }
    }

    if (allEntries.length === 0) {
        return { type: 'text', value: 'No plugins installed.' }
    }

    const lines: string[] = [chalk.bold(`Installed plugins (${allEntries.length}):`)]
    for (const entry of allEntries) {
        const version = entry.version ? chalk.dim(` v${entry.version}`) : ''
        const scope = chalk.dim(` [${entry.scope}]`)
        const installed = entry.installedAt
            ? chalk.dim(` (${new Date(entry.installedAt).toLocaleDateString()})`)
            : ''
        lines.push(`  ${chalk.cyan(entry.id)}${version}${scope}${installed}`)
    }
    lines.push('')
    lines.push(chalk.dim('Use /plugins preview <name> to see details before enabling.'))

    logForDebugging(`[plugins] Listed ${allEntries.length} installed plugins`)
    return { type: 'text', value: lines.join('\n') }
}

function previewPlugin(name: string): { type: 'text'; value: string } {
    if (!name) {
        return { type: 'text', value: 'Usage: /plugins preview <plugin-name>\nExample: /plugins preview github@builtin' }
    }

    const { enabled, disabled } = getBuiltinPlugins()
    const builtin = [...enabled, ...disabled].find(
        p => p.name === name || `${p.name}@builtin` === name,
    )

    if (builtin) {
        const lines: string[] = []
        lines.push(chalk.bold.cyan(`${builtin.name}@builtin`))
        lines.push(`  ${chalk.bold('Description:')} ${builtin.manifest.description}`)
        if (builtin.manifest.version) {
            lines.push(`  ${chalk.bold('Version:')} ${builtin.manifest.version}`)
        }
        lines.push(`  ${chalk.bold('Status:')} ${builtin.enabled ? chalk.green('enabled') : chalk.yellow('disabled')}`)
        lines.push(`  ${chalk.bold('Source:')} builtin (ships with fusion-code)`)
        if (builtin.hooksConfig && Object.keys(builtin.hooksConfig).length > 0) {
            lines.push(`  ${chalk.bold('Hooks:')} ${Object.keys(builtin.hooksConfig).join(', ')}`)
        }
        if (builtin.mcpServers && Object.keys(builtin.mcpServers).length > 0) {
            lines.push(`  ${chalk.bold('MCP Servers:')} ${Object.keys(builtin.mcpServers).join(', ')}`)
        }
        logForDebugging(`[plugins] Previewed builtin plugin: ${builtin.name}`)
        return { type: 'text', value: lines.join('\n') }
    }

    const pluginsFile = loadInstalledPluginsV2()
    for (const [pluginId, installations] of Object.entries(pluginsFile.plugins)) {
        if (pluginId === name || pluginId.startsWith(name + '@')) {
            const inst = installations[0]
            if (!inst) continue
            const lines: string[] = []
            lines.push(chalk.bold.cyan(pluginId))
            lines.push(`  ${chalk.bold('Scope:')} ${inst.scope}`)
            if (inst.version) {
                lines.push(`  ${chalk.bold('Version:')} ${inst.version}`)
            }
            if (inst.installedAt) {
                lines.push(`  ${chalk.bold('Installed:')} ${new Date(inst.installedAt).toLocaleString()}`)
            }
            lines.push(`  ${chalk.bold('Path:')} ${inst.installPath}`)
            logForDebugging(`[plugins] Previewed installed plugin: ${pluginId}`)
            return { type: 'text', value: lines.join('\n') }
        }
    }

    return { type: 'text', value: `Plugin "${name}" not found. Use /plugins to list available plugins.` }
}

const plugins = {
    type: 'local',
    name: 'plugins',
    aliases: ['plugin'],
    description: 'List installed plugins, preview, discover official/community plugins, or check updates',
    argumentHint: '[list|preview <name>|discover [query]|update]',
    isEnabled: () => true,
    isHidden: false,
    supportsNonInteractive: true,
    load: () => Promise.resolve({ call }),
} satisfies Command

export default plugins
