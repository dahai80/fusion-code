import type { Command } from '../../commands.js'

const tui = {
    type: 'local-jsx',
    name: 'tui',
    description: 'Toggle TUI mode: flicker-free fullscreen rendering. Use /tui on|off|status.',
    argumentHint: 'on|off|status',
    load: () => import('./tui.js'),
} satisfies Command

export default tui
