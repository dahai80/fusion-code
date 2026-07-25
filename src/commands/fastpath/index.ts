import type { Command } from '../../commands.js'

const fastpath = {
    type: 'local',
    name: 'fastpath',
    description:
        'Inspect the deterministic Fast-Path rule engine. /fastpath --stats (hit counts), /fastpath --list (rules), /fastpath --test <input> (test match).',
    isEnabled: () => true,
    supportsNonInteractive: true,
    argumentHint: '[--stats] [--list] [--test input]',
    load: () => import('./fastpathCommand.js'),
} satisfies Command

export default fastpath
