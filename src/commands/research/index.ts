import type { Command } from '../../commands.js'
const research = {
    type: 'prompt',
    name: 'research',
    description: 'Deep research on a topic with structured report and citations',
    argumentHint: '<topic>',
    contentLength: 0,
    progressMessage: 'researching topic',
    source: 'builtin',
    async getPromptForCommand(args, _context) {
        const topic = args.trim()
        if (!topic) return 'Please provide a topic to research. Usage: /research <topic>'
        const { generateResearchPrompt } = await import('../../services/research/researchEngine.js')
        return generateResearchPrompt(topic)
    },
} satisfies Command
export default research
