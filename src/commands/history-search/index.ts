import type { Command } from '../../commands.js'
const historySearch = {
    type: 'local',
    name: 'history-search',
    description: 'Search past conversation transcripts by keyword',
    aliases: ['hsearch'],
    argumentHint: '<query>',
    supportsNonInteractive: true,
    load: () => import('./history-search.js'),
} satisfies Command
export default historySearch
