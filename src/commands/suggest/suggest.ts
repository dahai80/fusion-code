import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getSuggestions, inferContext, type SuggestionContext } from '../../services/suggestions/index.js'

const VALID_CONTEXTS: SuggestionContext[] = ['after_edit', 'after_error', 'after_create', 'after_refactor', 'after_research', 'default']

export const call: LocalCommandCall = async (args, _context) => {
    const arg = args.trim().toLowerCase()

    let ctx: SuggestionContext
    if (arg && VALID_CONTEXTS.includes(arg as SuggestionContext)) {
        ctx = arg as SuggestionContext
    } else if (arg) {
        ctx = inferContext(arg, true)
    } else {
        ctx = 'default'
    }

    const suggestions = getSuggestions(ctx)

    if (suggestions.length === 0) {
        return {
            type: 'text',
            value: 'No suggestions available for the current context.',
        } satisfies LocalCommandResult
    }

    const output = suggestions
        .map(s => `  [${s.shortcut}] ${s.label} — ${s.description} (${s.type})`)
        .join('\n')

    return {
        type: 'text',
        value: `Suggested actions (${ctx}):\n${output}`,
    } satisfies LocalCommandResult
}
