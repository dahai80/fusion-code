import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { BundledSkillDefinition } from '../../skills/bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

const UIPRO_SKILL_DIR = join(getClaudeConfigHomeDir(), 'skills', 'ui-ux-pro-max')
const UIPRO_CLAUDE_DIR = join(
    process.env.HOME || '',
    '.claude',
    'skills',
    'ui-ux-pro-max',
)

function findUiproAssetsSource(): string | null {
    if (existsSync(join(UIPRO_CLAUDE_DIR, 'SKILL.md'))) {
        return UIPRO_CLAUDE_DIR
    }
    try {
        const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf-8' }).trim()
        const npmAssets = join(npmRoot, 'uipro-cli', 'assets')
        if (existsSync(join(npmAssets, 'templates'))) {
            return 'npm'
        }
    } catch {}
    return null
}

export function isUiproInstalled(): boolean {
    return existsSync(join(UIPRO_SKILL_DIR, 'SKILL.md'))
        && existsSync(join(UIPRO_SKILL_DIR, 'scripts', 'search.py'))
}

function installFromClaudeDir(): boolean {
    if (!existsSync(join(UIPRO_CLAUDE_DIR, 'SKILL.md'))) return false
    try {
        mkdirSync(UIPRO_SKILL_DIR, { recursive: true })
        cpSync(UIPRO_CLAUDE_DIR, UIPRO_SKILL_DIR, { recursive: true })
        logForDebugging(`[Plugin:uipro] copied from ${UIPRO_CLAUDE_DIR} to ${UIPRO_SKILL_DIR}`)
        return true
    } catch (e) {
        logForDebugging(`[Plugin:uipro] copy from .claude failed: ${e instanceof Error ? e.message : String(e)}`)
        return false
    }
}

function installFromNpm(): boolean {
    try {
        const result = execFileSync('uipro', ['init', '--ai', 'claude', '--force', '--offline'], {
            encoding: 'utf-8',
            timeout: 30000,
            cwd: process.env.HOME || '/',
        })
        logForDebugging(`[Plugin:uipro] npm install result: ${result.slice(0, 200)}`)
        return isUiproInstalled()
    } catch (e) {
        logForDebugging(`[Plugin:uipro] npm install failed: ${e instanceof Error ? e.message : String(e)}`)
        return false
    }
}

function ensureUiproInstalled(): boolean {
    if (isUiproInstalled()) return true
    logForDebugging('[Plugin:uipro] skill not found, attempting auto-install...')

    if (installFromClaudeDir()) return true

    if (installFromNpm()) return true

    logForDebugging('[Plugin:uipro] auto-install failed; user can run: uipro init --ai claude')
    return false
}

const uiproSkill: BundledSkillDefinition = {
    name: 'ui-ux-pro-max',
    description:
        'UI/UX design intelligence with 67 styles, 96 palettes, 57 font pairings, 25 charts across 13 tech stacks. Generates complete design systems with BM25-powered search.',
    aliases: ['uipro', 'ui-ux'],
    whenToUse:
        'Use when building or redesigning UI, choosing color palettes, typography, layout patterns, or when the user asks for design guidance, landing page structure, or UX best practices.',
    allowedTools: [],
    userInvocable: true,
    getPromptForCommand: async (
        _args: string,
        _context: ToolUseContext,
    ): Promise<ContentBlockParam[]> => {
        ensureUiproInstalled()
        if (!isUiproInstalled()) {
            return [
                {
                    type: 'text',
                    text: 'UI/UX Pro Max skill data not available. Install it with:\n  npm install -g uipro-cli\n  uipro init --ai claude\nThen restart fusion-code.',
                },
            ]
        }
        const skillMd = readFileSync(join(UIPRO_SKILL_DIR, 'SKILL.md'), 'utf-8')
        const prompt = skillMd
            .replace(/^---[\s\S]*?---\n*/, '')
            .replace(
                /skills\/ui-ux-pro-max\/scripts\/search\.py/g,
                join(UIPRO_SKILL_DIR, 'scripts', 'search.py'),
            )
        return [{ type: 'text', text: `Base directory for this skill: ${UIPRO_SKILL_DIR}\n\n${prompt}` }]
    },
}

export function registerUiproPlugin(): void {
    const installed = isUiproInstalled()
    logForDebugging(
        `[Plugin:uipro] UI/UX Pro Max ${installed ? 'found' : 'not found'} at ${UIPRO_SKILL_DIR}`,
    )

    registerBuiltinPlugin({
        name: 'ui-ux-pro-max',
        description:
            'UI/UX Pro Max — 67 styles, 96 palettes, 57 font pairings, 25 charts, 13 stacks. Generates design systems with BM25 search. Requires Python 3.',
        version: '2.2.3',
        skills: [uiproSkill],
        isAvailable: () => true,
        defaultEnabled: true,
    })
}
