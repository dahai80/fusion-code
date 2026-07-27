import type { Command } from '../../commands.js'

const aside = {
    type: 'local',
    name: 'aside',
    description: 'Ask a quick side question without interrupting your current task',
    supportsNonInteractive: true,
    argumentHint: '<your question>',
    load: () => import('./aside.js'),
} satisfies Command

export default aside
