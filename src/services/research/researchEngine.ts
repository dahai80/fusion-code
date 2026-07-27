import { logForDebugging } from '../../utils/debug.js'

export interface ResearchStep {
    phase: 'plan' | 'search' | 'crossref' | 'synthesize'
    query: string
    status: 'pending' | 'running' | 'done' | 'failed'
    result?: string
}

export interface ResearchReport {
    topic: string
    steps: ResearchStep[]
    summary: string
    sources: string[]
    confidence: number
}

export function planResearch(topic: string): ResearchStep[] {
    const steps: ResearchStep[] = []
    const baseQueries = [
        topic,
        `${topic} best practices`,
        `${topic} latest developments`,
        `${topic} comparison alternatives`,
    ]
    for (const query of baseQueries) {
        steps.push({ phase: 'search', query, status: 'pending' })
    }
    steps.push({ phase: 'crossref', query: `Cross-reference findings for ${topic}`, status: 'pending' })
    steps.push({ phase: 'synthesize', query: `Synthesize research report for ${topic}`, status: 'pending' })
    logForDebugging(`[research] planned ${steps.length} steps for: ${topic}`)
    return steps
}

export function generateResearchPrompt(topic: string): string {
    return [
        `Research the following topic thoroughly: ${topic}`,
        '',
        'Follow this structured research workflow:',
        '',
        '1. **Plan** your search strategy - identify 5-10 key search queries',
        '2. **Search** - execute searches using WebSearch and WebFetch tools, gather information from multiple sources',
        '3. **Cross-reference** - verify claims from multiple sources, note contradictions',
        '4. **Synthesize** - compile findings into a structured report with:',
        '   - Executive Summary (2-3 sentences)',
        '   - Key Findings (numbered, with citations)',
        '   - Detailed Analysis (organized by theme)',
        '   - Sources (full URLs)',
        '   - Confidence Level (high/medium/low with reasoning)',
        '',
        'Requirements:',
        '- Every factual claim must cite a source',
        '- Present contradictory findings when sources disagree',
        '- Prioritize recent and authoritative sources',
        '- Mark uncertain claims explicitly',
        '- Use academic-quality prose',
        '',
        'Do NOT fabricate sources or citations. Only cite URLs you actually visited.',
    ].join('\n')
}
