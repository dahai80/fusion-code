import { TreeSitterIndex } from '../../services/treeSitter/index.js'
import { getCwd } from '../../utils/cwd.js'

const LOG_PREFIX = '[ast-cmd]'

let indexInstance: TreeSitterIndex | null = null

async function getIndex(): Promise<TreeSitterIndex> {
    if (indexInstance && indexInstance.initialized) return indexInstance
    const cwd = getCwd()
    indexInstance = new TreeSitterIndex(cwd)
    await indexInstance.init()
    return indexInstance
}

interface ParsedArgs {
    query?: string
    file?: string
    kind?: string
    stats: boolean
    refresh: boolean
}

function parseArgs(input: string): ParsedArgs {
    const args: ParsedArgs = { stats: false, refresh: false }
    const tokens = input.trim().split(/\s+/)

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === '--file' && tokens[i + 1]) {
            args.file = tokens[++i]
        } else if (t === '--kind' && tokens[i + 1]) {
            args.kind = tokens[++i]
        } else if (t === '--stats') {
            args.stats = true
        } else if (t === '--refresh') {
            args.refresh = true
        } else if (!t.startsWith('--') && t.length > 0) {
            args.query = t
        }
    }

    return args
}

export async function* handleAstCommand(input: string): AsyncGenerator<string> {
    const args = parseArgs(input)

    try {
        const idx = await getIndex()

        if (args.refresh) {
            indexInstance = new TreeSitterIndex(getCwd())
            await indexInstance.init()
            const s = indexInstance.stats
            yield `Re-indexed: ${s.files} files, ${s.symbols} symbols in ${s.durationMs}ms`
            return
        }

        if (args.stats) {
            const s = idx.stats
            yield `Files: ${s.files}\nSymbols: ${s.symbols}\nLast updated: ${new Date(s.lastUpdated).toISOString()}\nIndex time: ${s.durationMs}ms`
            return
        }

        if (args.file) {
            const outline = idx.getOutline(args.file)
            if (!outline) {
                yield `No symbols found in ${args.file}`
            } else {
                yield outline
            }
            return
        }

        if (args.kind) {
            const symbols = idx.queryByKind(args.kind as any)
            if (symbols.length === 0) {
                yield `No symbols of kind "${args.kind}" found`
            } else {
                const lines = symbols.slice(0, 50).map(s => {
                    const parent = s.parentName ? `${s.parentName}.` : ''
                    return `${s.file}:${s.lineStart} ${s.kind} ${parent}${s.name}`
                })
                yield lines.join('\n')
            }
            return
        }

        if (args.query) {
            const symbols = idx.queryByName(args.query)
            if (symbols.length === 0) {
                yield `No symbols matching "${args.query}" found`
            } else {
                const lines = symbols.slice(0, 30).map(s => {
                    const parent = s.parentName ? `${s.parentName}.` : ''
                    const sig = s.signature ? ` — ${s.signature}` : ''
                    return `${s.file}:${s.lineStart} ${s.kind} ${parent}${s.name}${sig}`
                })
                yield lines.join('\n')
            }
            return
        }

        yield `Usage: /ast <name> [--file path] [--kind kind] [--stats] [--refresh]\n\nKinds: function, method, class, interface, type, enum, variable, constant`
    } catch (e: any) {
        console.log(`${LOG_PREFIX} error: ${e.message}`)
        yield `AST index error: ${e.message}`
    }
}
