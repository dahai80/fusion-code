import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { detectProjectProfile } from '../../services/onboarding/index.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalCommandCall = async (_args, _context) => {
    const projectDir = getOriginalCwd()
    const profile = detectProjectProfile(projectDir)

    const sections = [
        `Fusion-Code Tour — ${profile.framework || profile.language} Project`,
        '',
        `Project: ${profile.projectType} | Framework: ${profile.framework} | Language: ${profile.language}`,
        '',
        'Essential Commands:',
        '  /help          — Show all commands',
        '  /model         — Switch models',
        '  /style         — Change response style',
        '  /memory-search — Search saved context',
        '',
        'Workflow Commands:',
        '  /plan          — Enter planning mode',
        '  /act           — Switch to implementation mode',
        '  /compact       — Compress conversation context',
        '  /suggest       — Get next action suggestions',
        '',
        'Power Features:',
        '  /research <topic>  — Deep research with citations',
        '  /deploy            — Detect and deploy to platforms',
        '  /preview           — Detect dev server settings',
        '  /diagram <desc>    — Generate diagrams',
        '  /run <code>        — Execute code snippets',
        '',
    ]

    if (profile.suggestedFeatures.length > 0) {
        sections.push('Suggested for your project:')
        for (const feature of profile.suggestedFeatures) {
            sections.push(`  ${feature}`)
        }
        sections.push('')
    }

    if (profile.tips.length > 0) {
        sections.push('Tips:')
        for (const tip of profile.tips) {
            sections.push(`  - ${tip}`)
        }
    }

    return {
        type: 'text',
        value: sections.join('\n'),
    } satisfies LocalCommandResult
}
