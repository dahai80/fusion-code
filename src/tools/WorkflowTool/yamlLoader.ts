import YAML from 'yaml'
import { logForDebugging } from '../../utils/debug.js'

interface YamlWorkflowStep {
    agent: string
    label?: string
    phase?: string
    schema?: Record<string, unknown>
    model?: string
    effort?: string
}

interface YamlWorkflow {
    name: string
    description: string
    phases?: Array<{ title: string; detail?: string }>
    steps: YamlWorkflowStep[]
    args?: unknown
}

// JSON.stringify produces a complete, properly-escaped JS string literal.
// Using it for all interpolated values prevents code injection via crafted YAML.
function jsStr(val: string): string {
    return JSON.stringify(val)
}

export function parseYamlWorkflow(content: string, source: string): string | null {
    try {
        const parsed = YAML.parse(content) as YamlWorkflow | null
        if (!parsed || !parsed.name || !parsed.steps) {
            logForDebugging(`[yamlLoader] invalid workflow: missing name or steps`)
            return null
        }

        const phases = parsed.phases || []
        const meta = {
            name: parsed.name,
            description: parsed.description || '',
            ...(phases.length > 0 ? { phases } : {}),
        }

        const lines: string[] = []
        lines.push(`export const meta = ${JSON.stringify(meta, null, 2)}`)
        lines.push('')

        let currentPhase = ''
        for (const step of parsed.steps) {
            if (step.phase && step.phase !== currentPhase) {
                lines.push(`phase(${jsStr(step.phase)})`)
                currentPhase = step.phase
            }

            const opts: string[] = []
            if (step.label) opts.push(`label: ${jsStr(step.label)}`)
            if (step.phase) opts.push(`phase: ${jsStr(step.phase)}`)
            if (step.model) opts.push(`model: ${jsStr(step.model)}`)
            if (step.effort) opts.push(`effort: ${jsStr(step.effort)}`)
            if (step.schema) opts.push(`schema: ${JSON.stringify(step.schema)}`)

            const optsStr = opts.length > 0 ? `, { ${opts.join(', ')} }` : ''
            if (!step.agent) {
                logForDebugging(`[yamlLoader] skipping step with missing agent field`)
                continue
            }
            lines.push(`await agent(${jsStr(step.agent)}${optsStr})`)
        }

        const script = lines.join('\n')
        logForDebugging(`[yamlLoader] converted YAML workflow "${parsed.name}" (${parsed.steps.length} steps)`)
        return script
    } catch (err) {
        logForDebugging(`[yamlLoader] parse error: ${(err as Error).message}`)
        return null
    }
}
