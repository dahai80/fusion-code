import { logForDebugging } from '../../utils/debug.js'

export interface DiagramOptions {
    type: 'flowchart' | 'sequence' | 'architecture' | 'state' | 'class'
    direction: 'TB' | 'LR' | 'BT' | 'RL'
    theme: 'default' | 'dark' | 'forest'
}

export function generateMermaidDiagram(
    description: string,
    options?: Partial<DiagramOptions>,
): string {
    const opts = { type: 'flowchart', direction: 'TB', theme: 'default', ...options }
    logForDebugging(`[visualizer] generating ${opts.type} diagram`)

    return [
        `Generate a Mermaid.js ${opts.type} diagram for the following description.`,
        `Direction: ${opts.direction}`,
        '',
        'Rules:',
        '- Use valid Mermaid.js syntax',
        `- Diagram type: ${opts.type}`,
        `- Direction: ${opts.direction}`,
        '- Keep node labels short (max 20 chars)',
        '- Use descriptive IDs',
        '- Include only essential connections',
        '',
        'Description:',
        description,
        '',
        'Output ONLY the Mermaid diagram code, wrapped in ```mermaid ``` blocks.',
    ].join('\n')
}

export function generateAsciiDiagram(description: string): string {
    return [
        'Create an ASCII-art diagram for the following description.',
        'Use box-drawing characters where possible.',
        'Keep it readable at 80 columns wide.',
        '',
        'Description:',
        description,
        '',
        'Output the ASCII diagram in a code block.',
    ].join('\n')
}
