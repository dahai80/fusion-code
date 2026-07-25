import type { Command } from '../../commands.js'

const search = {
    type: 'local',
    name: 'search',
    description:
        'BM25 local code search. /search <query> finds relevant files by keyword relevance. No vector DB required.',
    isEnabled: () => true,
    supportsNonInteractive: true,
    argumentHint: '<query> [--top N]',
    load: () => import('./searchCommand.js'),
} satisfies Command

export default search
