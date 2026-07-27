import type { Command } from '../../commands.js'
const diagram = {
    type: 'prompt',
    name: 'diagram',
    description: 'Generate a diagram (flowchart, sequence, architecture) from description',
    argumentHint: '<description>',
    contentLength: 0,
    progressMessage: 'generating diagram',
    source: 'builtin',
    async getPromptForCommand(args, _context) {
        const description = args.trim()
        if (!description) return 'Please describe the diagram. Usage: /diagram <description>'
        const { generateMermaidDiagram } = await import('../../services/visualizer/visualizer.js')
        return generateMermaidDiagram(description)
    },
} satisfies Command
export default diagram
