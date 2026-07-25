import { BM25Index } from '../../services/bm25/index.js'
import { getCwd } from '../../utils/cwd.js'

const LOG_PREFIX = '[search-cmd]'

let indexInstance: BM25Index | null = null

async function getIndex(): Promise<BM25Index> {
    if (indexInstance && indexInstance.initialized) return indexInstance
    const cwd = getCwd()
    indexInstance = new BM25Index(cwd)
    await indexInstance.init()
    return indexInstance
}

interface ParsedArgs {
    query?: string
    top: number
}

function parseArgs(input: string): ParsedArgs {
    const args: ParsedArgs = { top: 10 }
    const tokens = input.trim().split(/\s+/)

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === '--top' && tokens[i + 1]) {
            args.top = parseInt(tokens[++i], 10) || 10
        } else if (!t.startsWith('--') && t.length > 0) {
            const remaining = tokens.slice(i).filter(x => !x.startsWith('--top'))
            args.query = remaining.join(' ')
            break
        }
    }

    return args
}

export async function* handleSearchCommand(input: string): AsyncGenerator<string> {
    const args = parseArgs(input)

    if (!args.query) {
        yield `Usage: /search <query> [--top N]\n\nBM25 keyword search across your codebase. No vector DB required.`
        return
    }

    try {
        const idx = await getIndex()
        const results = idx.search(args.query, args.top)

        if (results.length === 0) {
            yield `No results for "${args.query}"`
            return
        }

        const lines = results.map((r, i) => {
            const header = `${i + 1}. ${r.file} (score: ${r.score})`
            const snippet = r.snippet
                .split('\n')
                .map(l => `   ${l}`)
                .join('\n')
            return `${header}\n${snippet}`
        })

        yield lines.join('\n\n')
    } catch (e: any) {
        console.log(`${LOG_PREFIX} error: ${e.message}`)
        yield `Search error: ${e.message}`
    }
}
