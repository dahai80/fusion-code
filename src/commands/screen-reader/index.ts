import type { Command } from '../../commands.js'

const screenReader = {
    type: 'local-jsx',
    name: 'screen-reader',
    description: 'Toggle screen reader accessibility mode (reduced motion, plain text status)',
    immediate: true,
    aliases: ['ax'],
    load: () => import('./screen-reader.js'),
} satisfies Command

export default screenReader
