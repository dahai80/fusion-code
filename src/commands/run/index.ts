import type { Command } from '../../commands.js'
const run = {
    type: 'prompt',
    name: 'run',
    description: 'Execute code in a sandboxed environment (Python/JS)',
    argumentHint: '<code>',
    contentLength: 0,
    progressMessage: 'executing code',
    source: 'builtin',
    async getPromptForCommand(args, _context) {
        const code = args.trim()
        if (!code) return 'Please provide code to execute. Usage: /run <code>'
        return [
            'Execute the following code and show the result.',
            'Use the Bash tool to run it.',
            'For Python: save to a temp file and run with python3.',
            'For JavaScript: save to a temp file and run with node.',
            'Show both the code and the output.',
            'If there is an error, explain it.',
            '',
            'Code to execute:',
            '```',
            code,
            '```',
        ].join('\n')
    },
} satisfies Command
export default run
