import type { Command } from '../../commands.js'

const style = {
    type: 'local-jsx',
    name: 'style',
    description: 'Switch response style: concise, explain, formal, or auto',
    argumentHint: '<concise|explain|formal|auto|default|explanatory|learning>',
    load: () => import('./style.js'),
} satisfies Command

export default style
