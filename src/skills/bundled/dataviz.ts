import { registerBundledSkill } from '../bundledSkills.js'

const DATAVIZ_PROMPT = `# Dataviz: Terminal Data Visualization

Generate terminal-friendly data visualizations from data provided by the user.

## Capabilities

1. **Bar Charts** — Horizontal/vertical bar charts using Unicode block characters (█ ▓ ▒ ░)
2. **Sparklines** — Inline mini-charts using Unicode sparkline characters (▁▂▃▄▅▆▇█)
3. **Tables** — Aligned ASCII/Unicode tables with borders (│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼)
4. **Tree Maps** — Proportional area visualization using block characters
5. **Pie Charts** — Circular distribution using Unicode circle/dot characters
6. **Timelines** — Gantt-style horizontal timelines
7. **Flow Diagrams** — Simple flow/sequence diagrams using arrows (→ ← ↓ ↑ ↔ ⇄)

## Rules

- Always use Unicode box-drawing and block characters for best terminal rendering
- Keep visualizations under 80 characters wide when possible (use 120 max)
- For numeric data, include axis labels and scale markers
- Color-code using ANSI when the terminal supports it (check TERM)
- If the data is too large, aggregate or sample rather than producing an unreadable chart
- Always show the raw data alongside or below the visualization for verification
- Handle edge cases: empty data, single value, negative numbers, non-numeric data

## Input

The user will provide data in any format: JSON, CSV, plain text, or natural language description.
Parse the data first, then choose the most appropriate visualization type.
If unsure, default to a bar chart with sparkline summary.`

export function registerDatavizSkill(): void {
    registerBundledSkill({
        name: 'dataviz',
        description: 'Generate terminal data visualizations (bar charts, sparklines, tables, pie charts)',
        aliases: ['dv'],
        argumentHint: '<data or description>',
        whenToUse: 'User wants to visualize data, see a chart, compare values, or view data distribution in the terminal',
        getPromptForCommand: async () => {
            return [{ type: 'text' as const, text: DATAVIZ_PROMPT }]
        },
    })
}
