// biome-ignore-all assist/source/organizeImports: imports must match registration order
import addDir from './commands/add-dir/index.js'
import cd from './commands/cd/index.js'
import clear from './commands/clear/index.js'
import color from './commands/color/index.js'
import commit from './commands/commit.js'
import copy from './commands/copy/index.js'
import compact from './commands/compact/index.js'
import config from './commands/config/index.js'
import { context, contextNonInteractive } from './commands/context/index.js'
// cost is now an alias of usage (stats command)
import diff from './commands/diff/index.js'
import ctx_viz from './commands/ctx_viz/index.js'
import doctor from './commands/doctor/index.js'
import memory from './commands/memory/index.js'
import help from './commands/help/index.js'
import ide from './commands/ide/index.js'
import init from './commands/init.js'
import initVerifiers from './commands/init-verifiers.js'
import keybindings from './commands/keybindings/index.js'
import login from './commands/login/index.js'
import ast from './commands/ast/index.js'
import fastpath from './commands/fastpath/index.js'
import search from './commands/search/index.js'
import loopTest from './commands/loop-test/index.js'
import logout from './commands/logout/index.js'
import breakCache from './commands/break-cache/index.js'
import mcp from './commands/mcp/index.js'
import resume from './commands/resume/index.js'
import session from './commands/session/index.js'
import status from './commands/status/index.js'
import tasks from './commands/tasks/index.js'
import terminalSetup from './commands/terminalSetup/index.js'
import theme from './commands/theme/index.js'
import vim from './commands/vim/index.js'
import { feature } from 'bun:bundle'
import permissions from './commands/permissions/index.js'
import plan from './commands/plan/index.js'
import fast from './commands/fast/index.js'
import passes from './commands/passes/index.js'
import privacySettings from './commands/privacy-settings/index.js'
import hooks from './commands/hooks/index.js'
import files from './commands/files/index.js'
import branch from './commands/branch/index.js'
import agents from './commands/agents/index.js'
import reloadPlugins from './commands/reload-plugins/index.js'
import reloadSkills from './commands/reload-skills/index.js'
import rewind from './commands/rewind/index.js'
import heapDump from './commands/heapdump/index.js'
import version from './commands/version.js'
import summary from './commands/summary/index.js'
import {
    resetLimits,
    resetLimitsNonInteractive,
} from './commands/reset-limits/index.js'
import sandboxToggle from './commands/sandbox-toggle/index.js'
import advisor from './commands/advisor.js'
import { logError } from './utils/log.js'
import { toError } from './utils/errors.js'
import { logForDebugging } from './utils/debug.js'
import {
    getSkillDirCommands,
    clearSkillCaches,
    getDynamicSkills,
} from './skills/loadSkillsDir.js'
import { getBundledSkills } from './skills/bundledSkills.js'
import { getBuiltinPluginSkillCommands } from './plugins/builtinPlugins.js'
import {
    getPluginCommands,
    clearPluginCommandCache,
    getPluginSkills,
    clearPluginSkillsCache,
} from './utils/plugins/loadPluginCommands.js'
import memoize from 'lodash-es/memoize.js'
import { asyncMemoize } from './utils/asyncMemoize.js'
import { isUsing3PServices, isClaudeAISubscriber } from './utils/auth.js'
import { isFirstPartyAnthropicBaseUrl } from './utils/model/providers.js'
import env from './commands/env/index.js'
import exit from './commands/exit/index.js'
import exportCommand from './commands/export/index.js'
import model from './commands/model/index.js'
import tag from './commands/tag/index.js'
import outputStyle from './commands/output-style/index.js'
import remoteEnv from './commands/remote-env/index.js'
import upgrade from './commands/upgrade/index.js'
import statusline from './commands/statusline.js'
import effort from './commands/effort/index.js'
import stats from './commands/stats/index.js'
import review from './commands/review/index.js'
import commitPushPr from './commands/commit-push-pr/index.js'
import securityReview from './commands/security-review/index.js'
import rename from './commands/rename/index.js'
import feedback from './commands/feedback/index.jsx'
import skills from './commands/skills/index.jsx'
// insights.ts is 113KB (3200 lines, includes diffLines/html rendering). Lazy
// shim defers the heavy module until /insights is actually invoked.
const usageReport: Command = {
    type: 'prompt',
    name: 'insights',
    description: 'Generate a report analyzing your Fusion-Code sessions',
    contentLength: 0,
    progressMessage: 'analyzing your sessions',
    source: 'builtin',
    async getPromptForCommand(args, context) {
        const real = (await import('./commands/insights.js')).default
        if (real.type !== 'prompt') throw new Error('unreachable')
        return real.getPromptForCommand(args, context)
    },
}
import { getSettingSourceName } from './utils/settings/constants.js'
import {
    type Command,
    getCommandName,
    isCommandEnabled,
} from './types/command.js'

// Re-export types from the centralized location
export type {
    Command,
    CommandBase,
    CommandResultDisplay,
    LocalCommandResult,
    LocalJSXCommandContext,
    PromptCommand,
    ResumeEntrypoint,
} from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'

// Commands that get eliminated from the external build
export const INTERNAL_ONLY_COMMANDS = [
    commit,
    initVerifiers,
    version,
    resetLimits,
    resetLimitsNonInteractive,
].filter(Boolean)

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
const COMMANDS = memoize((): Command[] => [
    addDir,
    cd,
    advisor,
    agents,
    branch,
    breakCache,
    clear,
    color,
    compact,
    config,
    commitPushPr,
    copy,
    context,
    contextNonInteractive,
    ctx_viz,
    diff,
    doctor,
    effort,
    env,
    exit,
    fast,
    feedback,
    files,
    heapDump,
    help,
    ide,
    init,
    keybindings,
    ast,
    fastpath,
    search,
    loopTest,
    mcp,
    memory,
    model,
    outputStyle,
    remoteEnv,
    reloadPlugins,
    reloadSkills,
    rename,
    review,
    resume,
    session,
    skills,
    stats,
    status,
    summary,
    statusline,
    tag,
    theme,
    rewind,
    terminalSetup,
    upgrade,
    vim,
    permissions,
    plan,
    privacySettings,
    hooks,
    exportCommand,
    sandboxToggle,
    securityReview,
    ...(!isUsing3PServices() ? [logout, login()] : []),
    passes,
    tasks,
    usageReport,
    ...(process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO
        ? INTERNAL_ONLY_COMMANDS
        : []),
])

export const builtInCommandNames = memoize(
    (): Set<string> =>
        new Set(COMMANDS().flatMap(_ => [_.name, ...(_.aliases ?? [])])),
)

async function getSkills(cwd: string): Promise<{
    skillDirCommands: Command[]
    pluginSkills: Command[]
    bundledSkills: Command[]
    builtinPluginSkills: Command[]
}> {
    try {
        const [skillDirCommands, pluginSkills] = await Promise.all([
            getSkillDirCommands(cwd).catch(err => {
                logError(toError(err))
                logForDebugging(
                    'Skill directory commands failed to load, continuing without them',
                )
                return []
            }),
            getPluginSkills().catch(err => {
                logError(toError(err))
                logForDebugging('Plugin skills failed to load, continuing without them')
                return []
            }),
        ])
        const bundledSkills = getBundledSkills()
        const builtinPluginSkills = getBuiltinPluginSkillCommands()
        logForDebugging(
            `getSkills returning: ${skillDirCommands.length} skill dir commands, ${pluginSkills.length} plugin skills, ${bundledSkills.length} bundled skills, ${builtinPluginSkills.length} builtin plugin skills`,
        )
        return {
            skillDirCommands,
            pluginSkills,
            bundledSkills,
            builtinPluginSkills,
        }
    } catch (err) {
        logError(toError(err))
        logForDebugging('Unexpected error in getSkills, returning empty')
        return {
            skillDirCommands: [],
            pluginSkills: [],
            bundledSkills: [],
            builtinPluginSkills: [],
        }
    }
}

/**
 * Filters commands by their declared `availability` (auth/provider requirement).
 * Commands without `availability` are treated as universal.
 */
export function meetsAvailabilityRequirement(cmd: Command): boolean {
    if (!cmd.availability) return true
    for (const a of cmd.availability) {
        switch (a) {
            case 'claude-ai':
                if (isClaudeAISubscriber()) return true
                break
            case 'console':
                if (
                    !isClaudeAISubscriber() &&
                    !isUsing3PServices() &&
                    isFirstPartyAnthropicBaseUrl()
                )
                    return true
                break
            default: {
                const _exhaustive: never = a
                void _exhaustive
                break
            }
        }
    }
    return false
}

/**
 * Loads all command sources (skills, plugins). Memoized by cwd.
 */
const loadAllCommands = asyncMemoize(async (cwd: string): Promise<Command[]> => {
    const [
        { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
        pluginCommands,
    ] = await Promise.all([
        getSkills(cwd),
        getPluginCommands(),
    ])

    return [
        ...bundledSkills,
        ...builtinPluginSkills,
        ...skillDirCommands,
        ...pluginCommands,
        ...pluginSkills,
        ...COMMANDS(),
    ]
})

/**
 * Returns commands available to the current user.
 */
export async function getCommands(cwd: string): Promise<Command[]> {
    const allCommands = await loadAllCommands(cwd)
    const dynamicSkills = getDynamicSkills()
    const baseCommands = allCommands.filter(
        _ => meetsAvailabilityRequirement(_) && isCommandEnabled(_),
    )

    if (dynamicSkills.length === 0) {
        return baseCommands
    }

    const baseCommandNames = new Set(baseCommands.map(c => c.name))
    const uniqueDynamicSkills = dynamicSkills.filter(
        s =>
            !baseCommandNames.has(s.name) &&
            meetsAvailabilityRequirement(s) &&
            isCommandEnabled(s),
    )

    if (uniqueDynamicSkills.length === 0) {
        return baseCommands
    }

    const builtInNames = new Set(COMMANDS().map(c => c.name))
    const insertIndex = baseCommands.findIndex(c => builtInNames.has(c.name))

    if (insertIndex === -1) {
        return [...baseCommands, ...uniqueDynamicSkills]
    }

    return [
        ...baseCommands.slice(0, insertIndex),
        ...uniqueDynamicSkills,
        ...baseCommands.slice(insertIndex),
    ]
}

/**
 * Clears only the memoization caches for commands, WITHOUT clearing skill caches.
 */
export function clearCommandMemoizationCaches(): void {
    loadAllCommands.cache?.clear?.()
    getSkillToolCommands.cache?.clear?.()
    getSlashCommandToolSkills.cache?.clear?.()
}

export function clearCommandsCache(): void {
    clearCommandMemoizationCaches()
    clearPluginCommandCache()
    clearPluginSkillsCache()
    clearSkillCaches()
}

/**
 * Filter AppState.mcp.commands to MCP-provided skills.
 */
export function getMcpSkillCommands(
    mcpCommands: readonly Command[],
): readonly Command[] {
    if (feature('MCP_SKILLS')) {
        return mcpCommands.filter(
            cmd =>
                cmd.type === 'prompt' &&
                cmd.loadedFrom === 'mcp' &&
                !cmd.disableModelInvocation,
        )
    }
    return []
}

// SkillTool shows ALL prompt-based commands that the model can invoke
export const getSkillToolCommands = memoize(
    async (cwd: string): Promise<Command[]> => {
        const allCommands = await getCommands(cwd)
        return allCommands.filter(
            cmd =>
                cmd.type === 'prompt' &&
                !cmd.disableModelInvocation &&
                cmd.source !== 'builtin' &&
                (cmd.loadedFrom === 'bundled' ||
                    cmd.loadedFrom === 'skills' ||
                    cmd.loadedFrom === 'commands_DEPRECATED' ||
                    cmd.hasUserSpecifiedDescription ||
                    cmd.whenToUse),
        )
    },
)

// Filters commands to include only skills.
export const getSlashCommandToolSkills = memoize(
    async (cwd: string): Promise<Command[]> => {
        try {
            const allCommands = await getCommands(cwd)
            return allCommands.filter(
                cmd =>
                    cmd.type === 'prompt' &&
                    cmd.source !== 'builtin' &&
                    (cmd.hasUserSpecifiedDescription || cmd.whenToUse) &&
                    (cmd.loadedFrom === 'skills' ||
                        cmd.loadedFrom === 'plugin' ||
                        cmd.loadedFrom === 'bundled' ||
                        cmd.disableModelInvocation),
            )
        } catch (error) {
            logError(toError(error))
            logForDebugging('Returning empty skills array due to load failure')
            return []
        }
    },
)

/**
 * Whether a slash command is safe to execute when its input arrived over the
 * Remote Control bridge (mobile/web client).
 */
export function isBridgeSafeCommand(cmd: Command): boolean {
    if (cmd.type === 'local-jsx') return false
    if (cmd.type === 'prompt') return true
    return false
}

/**
 * Filter commands to only include those safe for remote mode.
 */
export function filterCommandsForRemoteMode(commands: Command[]): Command[] {
    return commands.filter(cmd =>
        [session, exit, clear, help, theme, color, vim, copy, plan, keybindings, statusline, stats].some(safe => safe === cmd)
    )
}

export function findCommand(
    commandName: string,
    commands: Command[],
): Command | undefined {
    return commands.find(
        _ =>
            _.name === commandName ||
            getCommandName(_) === commandName ||
            _.aliases?.includes(commandName),
    )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
    return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
    const command = findCommand(commandName, commands)
    if (!command) {
        throw ReferenceError(
            `Command ${commandName} not found. Available commands: ${commands
                .map(_ => {
                    const name = getCommandName(_)
                    return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
                })
                .sort((a, b) => a.localeCompare(b))
                .join(', ')}`,
        )
    }
    return command
}

/**
 * Formats a command's description with its source annotation for user-facing UI.
 */
export function formatDescriptionWithSource(cmd: Command): string {
    if (cmd.type !== 'prompt') {
        return cmd.description
    }

    if (cmd.kind === 'workflow') {
        return `${cmd.description} (workflow)`
    }

    if (cmd.source === 'plugin') {
        const pluginName = cmd.pluginInfo?.pluginManifest.name
        if (pluginName) {
            return `(${pluginName}) ${cmd.description}`
        }
        return `${cmd.description} (plugin)`
    }

    if (cmd.source === 'builtin' || cmd.source === 'mcp') {
        return cmd.description
    }

    if (cmd.source === 'bundled') {
        return `${cmd.description} (bundled)`
    }

    return `${cmd.description} (${getSettingSourceName(cmd.source)})`
}
