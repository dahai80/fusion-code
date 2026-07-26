import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const STYLE_MAP: Record<string, { label: string; description: string }> = {
    concise: {
        label: 'Concise',
        description: 'Token-efficient, no hedging, code-first responses',
    },
    explain: {
        label: 'Explanatory',
        description: 'Teacher-like, explains why, shows alternatives',
    },
    formal: {
        label: 'Formal',
        description: 'Business-appropriate, structured, citation-heavy',
    },
    auto: {
        label: 'Auto',
        description: 'Adapt based on user expertise and patterns',
    },
    default: {
        label: 'Default',
        description: 'Standard balanced response style',
    },
    explanatory: {
        label: 'Explanatory',
        description: 'Built-in explanatory style with insights',
    },
    learning: {
        label: 'Learning',
        description: 'Built-in learning style with hands-on practice',
    },
}

const CUSTOM_STYLE_PROMPTS: Record<string, string> = {
    concise:
        '- Be token-efficient. No hedging. Code-first. Skip explanations unless asked. Use short variable names in examples. Minimize prose.',
    explain:
        '- Be teacher-like. Explain why, not just what. Show alternatives. Use analogies. Include educational insights. Balance depth with clarity.',
    formal:
        '- Be business-appropriate. Structured responses with headers. Citation-heavy. Precise language. No colloquialisms. Formal tone throughout.',
    auto:
        '- Adapt response style based on user expertise. Short commands → concise. "Why" questions → explanatory. Technical terms → assume expertise. Simplification without request is condescension.',
}

export async function call(
    onDone: LocalJSXCommandOnDone,
    _context: LocalJSXCommandContext,
    args: string,
): Promise<React.ReactNode> {
    const requestedStyle = args.trim().toLowerCase()

    if (!requestedStyle) {
        const styles = Object.entries(STYLE_MAP)
        const lines = styles.map(
            ([key, val]) => `  ${key.padEnd(14)} ${val.description}`,
        )
        onDone(`Available styles:\n${lines.join('\n')}\n\nUsage: /style <name>`)
        return null
    }

    const matched = STYLE_MAP[requestedStyle]
    if (!matched) {
        const available = Object.keys(STYLE_MAP).join(', ')
        onDone(`Unknown style "${requestedStyle}". Available: ${available}`)
        return null
    }

    const isBuiltin = ['default', 'explanatory', 'learning'].includes(requestedStyle)

    if (isBuiltin) {
        console.log(`[style] switching to built-in output style: ${requestedStyle}`)
        onDone(`Switched to ${matched.label} style: ${matched.description}`, {
            shouldQuery: false,
            metaMessages: [
                `The user has requested "${requestedStyle}" output style. Apply the "${matched.label}" response style going forward: ${matched.description}`,
            ],
        })
        return null
    }

    const customPrompt = CUSTOM_STYLE_PROMPTS[requestedStyle]
    console.log(`[style] switching to custom style: ${requestedStyle}`)
    onDone(`Switched to ${matched.label} style: ${matched.description}`, {
        shouldQuery: false,
        metaMessages: [
            `The user has requested "${requestedStyle}" response style. Apply these rules going forward:\n${customPrompt}`,
        ],
    })
    return null
}
