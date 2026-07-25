import type { Command } from '../../commands.js'

const loopTest = {
    type: 'local',
    name: 'loop-test',
    description:
        'Run tests in a self-correction loop. Auto-detects test command or use /loop-test <command>. Iterates until tests pass or max iterations reached.',
    isEnabled: () => true,
    supportsNonInteractive: true,
    argumentHint: '[test-command] [--max N] [--build cmd]',
    load: () => import('./loopTest.js'),
} satisfies Command

export default loopTest
