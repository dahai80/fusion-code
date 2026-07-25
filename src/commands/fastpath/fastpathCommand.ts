import { FastPathEngine } from '../../services/fastPath/index.js'

const LOG_PREFIX = '[fastpath-cmd]'

let engineInstance: FastPathEngine | null = null

function getEngine(): FastPathEngine {
    if (!engineInstance) {
        engineInstance = new FastPathEngine()
    }
    return engineInstance
}

interface ParsedArgs {
    stats: boolean
    list: boolean
    test?: string
}

function parseArgs(input: string): ParsedArgs {
    const args: ParsedArgs = { stats: false, list: false }
    const tokens = input.trim().split(/\s+/)

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === '--stats') {
            args.stats = true
        } else if (t === '--list') {
            args.list = true
        } else if (t === '--test' && tokens[i + 1]) {
            args.test = tokens.slice(i + 1).join(' ')
            break
        }
    }

    return args
}

export async function* handleFastpathCommand(input: string): AsyncGenerator<string> {
    const args = parseArgs(input)

    try {
        const engine = getEngine()

        if (args.stats) {
            const s = engine.getStats()
            const hitLines = Object.entries(s.hits)
                .map(([name, count]) => `  ${name}: ${count}`)
                .join('\n')
            yield `Rules: ${s.rules}\nHits:\n${hitLines || '  (none)'}`
            return
        }

        if (args.list) {
            const names = ['version_query', 'help_query', 'echo_test', 'env_check', 'json_format', 'timestamp_query']
            yield `Built-in rules:\n${names.map(n => `  ${n}`).join('\n')}`
            return
        }

        if (args.test) {
            const result = engine.evaluate(args.test)
            if (result.handled) {
                yield `Matched rule: ${result.ruleName} (${result.durationMs}ms)\nResponse: ${result.response}`
            } else {
                yield `No rule matched (${result.durationMs}ms)`
            }
            return
        }

        yield `Usage: /fastpath [--stats] [--list] [--test <input>]\n\nDeterministic rule engine that intercepts simple queries before model invocation (MLX only).`
    } catch (e: any) {
        console.log(`${LOG_PREFIX} error: ${e.message}`)
        yield `Fast-Path error: ${e.message}`
    }
}
