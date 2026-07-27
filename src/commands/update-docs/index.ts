import type { Command } from '../../commands.js'

const updateDocs = {
    type: 'local',
    name: 'update-docs',
    description: 'Sync documentation from source-of-truth files (scripts, schemas, routes, exports)',
    aliases: ['docs'],
    supportsNonInteractive: true,
    argumentHint: '[section]',
    load: () => import('./updateDocs.js'),
} satisfies Command

export default updateDocs
