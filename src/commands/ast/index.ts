import type { Command } from '../../commands.js'

const ast = {
    type: 'local',
    name: 'ast',
    description:
        'Query the Tree-Sitter AST index. Usage: /ast <name> (find symbol), /ast --file <path> (file outline), /ast --kind <kind> (filter by kind), /ast --stats (index stats), /ast --refresh (re-index).',
    isEnabled: () => true,
    supportsNonInteractive: true,
    argumentHint: '[name] [--file path] [--kind kind] [--stats] [--refresh]',
    load: () => import('./astCommand.js'),
} satisfies Command

export default ast
