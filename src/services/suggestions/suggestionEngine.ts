import { logForDebugging } from '../../utils/debug.js'

export interface SuggestedAction {
    id: string
    label: string
    description: string
    type: 'next_edit' | 'test' | 'deploy' | 'fix' | 'research' | 'review' | 'refactor'
    shortcut: number  // 1-5
}

const ACTION_TEMPLATES: Record<string, SuggestedAction[]> = {
    after_edit: [
        { id: 'run_test', label: 'Run tests', description: 'Verify changes with test suite', type: 'test', shortcut: 1 },
        { id: 'review_diff', label: 'Review diff', description: 'Check the full diff of changes', type: 'review', shortcut: 2 },
        { id: 'commit', label: 'Commit changes', description: 'Stage and commit the edits', type: 'deploy', shortcut: 3 },
        { id: 'lint', label: 'Lint & fix', description: 'Run linter on changed files', type: 'fix', shortcut: 4 },
    ],
    after_error: [
        { id: 'fix_error', label: 'Fix the error', description: 'Debug and fix the reported error', type: 'fix', shortcut: 1 },
        { id: 'search_docs', label: 'Search docs', description: 'Look up documentation for the error', type: 'research', shortcut: 2 },
        { id: 'show_trace', label: 'Show stack trace', description: 'Display full error trace', type: 'review', shortcut: 3 },
    ],
    after_create: [
        { id: 'add_test', label: 'Add tests', description: 'Write tests for the new file', type: 'test', shortcut: 1 },
        { id: 'update_imports', label: 'Update imports', description: 'Add imports for the new module', type: 'next_edit', shortcut: 2 },
        { id: 'update_readme', label: 'Update README', description: 'Document the new feature', type: 'review', shortcut: 3 },
    ],
    after_refactor: [
        { id: 'run_tests', label: 'Run full tests', description: 'Verify nothing broke', type: 'test', shortcut: 1 },
        { id: 'check_types', label: 'Type check', description: 'Run type checker on project', type: 'review', shortcut: 2 },
        { id: 'review_changes', label: 'Review all changes', description: 'Inspect all modified files', type: 'review', shortcut: 3 },
    ],
    after_research: [
        { id: 'implement', label: 'Implement', description: 'Start implementing the findings', type: 'next_edit', shortcut: 1 },
        { id: 'save_note', label: 'Save to memory', description: 'Save findings as memory note', type: 'review', shortcut: 2 },
        { id: 'create_plan', label: 'Create plan', description: 'Plan implementation steps', type: 'review', shortcut: 3 },
    ],
    default: [
        { id: 'continue', label: 'Continue', description: 'Continue current work', type: 'next_edit', shortcut: 1 },
        { id: 'review', label: 'Review progress', description: 'Review what has been done', type: 'review', shortcut: 2 },
        { id: 'test', label: 'Run tests', description: 'Verify with test suite', type: 'test', shortcut: 3 },
        { id: 'commit', label: 'Commit', description: 'Commit current changes', type: 'deploy', shortcut: 4 },
    ],
}

export type SuggestionContext = 'after_edit' | 'after_error' | 'after_create' | 'after_refactor' | 'after_research' | 'default'

export function inferContext(lastToolUsed: string, lastResponseSucceeded: boolean): SuggestionContext {
    if (!lastResponseSucceeded) return 'after_error'

    const tool = lastToolUsed.toLowerCase()
    if (tool.includes('edit') || tool.includes('write') || tool.includes('replace')) return 'after_edit'
    if (tool.includes('create') || tool.includes('new')) return 'after_create'
    if (tool.includes('refactor') || tool.includes('rename') || tool.includes('move')) return 'after_refactor'
    if (tool.includes('search') || tool.includes('fetch') || tool.includes('web')) return 'after_research'

    return 'default'
}

export function getSuggestions(
    context: SuggestionContext,
    maxSuggestions: number = 5,
): SuggestedAction[] {
    const templates = ACTION_TEMPLATES[context] || ACTION_TEMPLATES.default
    const suggestions = templates.slice(0, maxSuggestions).map((s, i) => ({
        ...s,
        shortcut: i + 1,
    }))
    logForDebugging(`[suggestions] context=${context} count=${suggestions.length}`)
    return suggestions
}
