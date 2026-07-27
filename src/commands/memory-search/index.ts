import type { Command } from '../../commands.js'

const memorySearch = {
    type: 'local',
    name: 'memory-search',
    description: 'Search memory files by keyword or path',
    aliases: ['msearch'],
    argumentHint: '<query>',
    supportsNonInteractive: true,
    load: () => import('./memory-search.js'),
} satisfies Command

export default memorySearch
