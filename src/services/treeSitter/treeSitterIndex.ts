import { readFile, readdir, stat } from 'fs/promises'
import { join, extname, relative } from 'path'
import { logEvent } from '../analytics/index.js'
import { isFusionMlxProvider } from '../../utils/model/providers.js'

const LOG_PREFIX = '[treeSitter]'

export type SymbolKind =
    | 'function'
    | 'method'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'variable'
    | 'constant'
    | 'import'
    | 'property'
    | 'field'
    | 'namespace'

export interface SymbolInfo {
    name: string
    kind: SymbolKind
    file: string
    lineStart: number
    lineEnd: number
    signature?: string
    parentName?: string
}

export interface IndexStats {
    files: number
    symbols: number
    lastUpdated: number
    durationMs: number
}

const SUPPORTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py',
    '.rs',
    '.go',
    '.c', '.h', '.cpp', '.hpp', '.cc',
    '.java',
    '.rb',
    '.swift',
])

const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
    '.venv', 'venv', 'target', 'vendor', '.cache', '.codegraph',
])

const MAX_FILE_SIZE = 256 * 1024
const MAX_FILES = 2000

function shouldIgnoreDir(name: string): boolean {
    return IGNORE_DIRS.has(name) || name.startsWith('.')
}

function shouldIndexFile(filePath: string): boolean {
    const ext = extname(filePath)
    return SUPPORTED_EXTENSIONS.has(ext)
}

interface ParsedFile {
    path: string
    symbols: SymbolInfo[]
    content: string
    lineCount: number
}

export class TreeSitterIndex {
    private symbols: Map<string, SymbolInfo[]> = new Map()
    private fileIndex: Map<string, ParsedFile> = new Map()
    private nameIndex: Map<string, SymbolInfo[]> = new Map()
    private rootDir: string
    private lastStats: IndexStats = { files: 0, symbols: 0, lastUpdated: 0, durationMs: 0 }
    private _initialized = false
    private parser: any = null

    constructor(rootDir: string) {
        this.rootDir = rootDir
    }

    async init(): Promise<void> {
        if (this._initialized) return
        const start = Date.now()

        try {
            const Parser = await import('web-tree-sitter')
            await Parser.init()
            this.parser = new Parser()
        } catch (e) {
            console.log(`${LOG_PREFIX} web-tree-sitter init failed, using regex fallback: ${e}`)
            this.parser = null
        }

        await this.indexDirectory(this.rootDir)

        this.lastStats.durationMs = Date.now() - start
        this.lastStats.lastUpdated = Date.now()
        this._initialized = true

        console.log(
            `${LOG_PREFIX} initialized: ${this.lastStats.files} files, ${this.lastStats.symbols} symbols in ${this.lastStats.durationMs}ms`,
        )

        logEvent('tree_sitter_index', {
            files: this.lastStats.files,
            symbols: this.lastStats.symbols,
            duration_ms: this.lastStats.durationMs,
            has_parser: !!this.parser,
            is_mlx: isFusionMlxProvider(),
        })
    }

    get stats(): IndexStats {
        return { ...this.lastStats }
    }

    get initialized(): boolean {
        return this._initialized
    }

    queryByName(name: string): SymbolInfo[] {
        const exact = this.nameIndex.get(name) ?? []
        if (exact.length > 0) return exact

        const lower = name.toLowerCase()
        const results: SymbolInfo[] = []
        for (const [key, syms] of this.nameIndex) {
            if (key.toLowerCase().includes(lower)) {
                results.push(...syms)
            }
            if (results.length >= 50) break
        }
        return results
    }

    queryByFile(filePath: string): SymbolInfo[] {
        const rel = relative(this.rootDir, filePath)
        return this.symbols.get(rel) ?? []
    }

    queryByKind(kind: SymbolKind): SymbolInfo[] {
        const results: SymbolInfo[] = []
        for (const syms of this.symbols.values()) {
            for (const s of syms) {
                if (s.kind === kind) results.push(s)
            }
            if (results.length >= 200) break
        }
        return results
    }

    getFileContent(filePath: string): string | null {
        const rel = relative(this.rootDir, filePath)
        return this.fileIndex.get(rel)?.content ?? null
    }

    getFileSymbols(filePath: string): SymbolInfo[] {
        const rel = relative(this.rootDir, filePath)
        return this.symbols.get(rel) ?? []
    }

    getOutline(filePath: string): string {
        const symbols = this.queryByFile(filePath)
        if (symbols.length === 0) return ''

        const parts: string[] = []
        for (const s of symbols) {
            const loc = `L${s.lineStart}`
            const parent = s.parentName ? `${s.parentName}.` : ''
            const sig = s.signature ? ` ${s.signature}` : ''
            parts.push(`${loc} ${s.kind} ${parent}${s.name}${sig}`)
        }
        return parts.join('\n')
    }

    async refreshFile(filePath: string): Promise<void> {
        const rel = relative(this.rootDir, filePath)
        if (!shouldIndexFile(filePath)) return

        try {
            const content = await readFile(filePath, 'utf-8')
            const symbols = this.parseFile(rel, content)
            this.symbols.set(rel, symbols)
            this.fileIndex.set(rel, {
                path: rel,
                symbols,
                content,
                lineCount: content.split('\n').length,
            })
            this.rebuildNameIndex()
        } catch (e) {
            console.log(`${LOG_PREFIX} refresh failed for ${rel}: ${e}`)
        }
    }

    private async indexDirectory(dir: string, depth = 0): Promise<void> {
        if (depth > 10) return
        if (this.lastStats.files >= MAX_FILES) return

        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }

        const tasks: Promise<void>[] = []

        for (const entry of entries) {
            if (this.lastStats.files >= MAX_FILES) break

            const fullPath = join(dir, entry.name)

            if (entry.isDirectory()) {
                if (shouldIgnoreDir(entry.name)) continue
                tasks.push(this.indexDirectory(fullPath, depth + 1))
            } else if (entry.isFile() && shouldIndexFile(entry.name)) {
                tasks.push(this.indexFile(fullPath))
            }
        }

        await Promise.all(tasks)
    }

    private async indexFile(fullPath: string): Promise<void> {
        try {
            const s = await stat(fullPath)
            if (s.size > MAX_FILE_SIZE) return

            const content = await readFile(fullPath, 'utf-8')
            const rel = relative(this.rootDir, fullPath)
            const symbols = this.parseFile(rel, content)

            this.symbols.set(rel, symbols)
            this.fileIndex.set(rel, {
                path: rel,
                symbols,
                content,
                lineCount: content.split('\n').length,
            })

            this.lastStats.files++
            this.lastStats.symbols += symbols.length

            for (const sym of symbols) {
                const existing = this.nameIndex.get(sym.name) ?? []
                existing.push(sym)
                this.nameIndex.set(sym.name, existing)
            }
        } catch {
            // skip unreadable files
        }
    }

    private parseFile(filePath: string, content: string): SymbolInfo[] {
        const ext = extname(filePath)
        switch (ext) {
            case '.ts':
            case '.tsx':
            case '.js':
            case '.jsx':
            case '.mjs':
                return this.parseTSFile(filePath, content)
            case '.py':
                return this.parsePyFile(filePath, content)
            case '.rs':
                return this.parseRustFile(filePath, content)
            case '.go':
                return this.parseGoFile(filePath, content)
            default:
                return []
        }
    }

    private parseTSFile(filePath: string, content: string): SymbolInfo[] {
        const symbols: SymbolInfo[] = []
        const lines = content.split('\n')

        const patterns: Array<{
            regex: RegExp
            kind: SymbolKind
            extractName: (m: RegExpMatchArray) => string
            extractSig?: (m: RegExpMatchArray) => string
        }> = [
            {
                regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
                kind: 'class',
                extractName: m => m[1],
            },
            {
                regex: /^\s*(?:export\s+)?(?:abstract\s+)?interface\s+(\w+)/,
                kind: 'interface',
                extractName: m => m[1],
            },
            {
                regex: /^\s*(?:export\s+)?type\s+(\w+)\s*(?:<|=)/,
                kind: 'type',
                extractName: m => m[1],
            },
            {
                regex: /^\s*(?:export\s+)?enum\s+(\w+)/,
                kind: 'enum',
                extractName: m => m[1],
            },
            {
                regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/,
                kind: 'function',
                extractName: m => m[1],
                extractSig: m => m[0].trim(),
            },
            {
                regex: /^\s*(?:export\s+)?(?:async\s+)?(?:private|public|protected|static)?\s*(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/,
                kind: 'method',
                extractName: m => m[1],
                extractSig: m => m[0].trim(),
            },
            {
                regex: /^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/,
                kind: 'constant',
                extractName: m => m[1],
            },
            {
                regex: /^\s*(?:export\s+)?let\s+(\w+)\s*[:=]/,
                kind: 'variable',
                extractName: m => m[1],
            },
        ]

        let currentClass: string | null = null
        let braceDepth = 0

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            braceDepth += (line.match(/{/g) ?? []).length
            braceDepth -= (line.match(/}/g) ?? []).length
            if (braceDepth <= 0) currentClass = null

            for (const p of patterns) {
                const m = line.match(p.regex)
                if (m) {
                    const name = p.extractName(m)
                    if (name === 'if' || name === 'for' || name === 'while' || name === 'switch' || name === 'catch') {
                        continue
                    }

                    if (p.kind === 'class') currentClass = name

                    symbols.push({
                        name,
                        kind: p.kind,
                        file: filePath,
                        lineStart: i + 1,
                        lineEnd: i + 1,
                        signature: p.extractSig?.(m),
                        parentName: p.kind === 'method' ? currentClass ?? undefined : undefined,
                    })
                    break
                }
            }
        }

        return symbols
    }

    private parsePyFile(filePath: string, content: string): SymbolInfo[] {
        const symbols: SymbolInfo[] = []
        const lines = content.split('\n')

        let currentClass: string | null = null

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const classMatch = line.match(/^class\s+(\w+)/)
            if (classMatch) {
                currentClass = classMatch[1]
                symbols.push({
                    name: classMatch[1],
                    kind: 'class',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    signature: line.trim(),
                })
                continue
            }

            const funcMatch = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)/)
            if (funcMatch) {
                const indent = funcMatch[1].length
                const name = funcMatch[2]
                const isMethod = indent > 0 && currentClass !== null

                symbols.push({
                    name,
                    kind: isMethod ? 'method' : 'function',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    signature: line.trim(),
                    parentName: isMethod ? currentClass ?? undefined : undefined,
                })
                continue
            }

            if (line.match(/^\S/)) currentClass = null
        }

        return symbols
    }

    private parseRustFile(filePath: string, content: string): SymbolInfo[] {
        const symbols: SymbolInfo[] = []
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const fnMatch = line.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/)
            if (fnMatch) {
                symbols.push({
                    name: fnMatch[1],
                    kind: 'function',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    signature: line.trim(),
                })
                continue
            }

            const structMatch = line.match(/^\s*(?:pub\s+)?struct\s+(\w+)/)
            if (structMatch) {
                symbols.push({
                    name: structMatch[1],
                    kind: 'class',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    signature: line.trim(),
                })
                continue
            }

            const enumMatch = line.match(/^\s*(?:pub\s+)?enum\s+(\w+)/)
            if (enumMatch) {
                symbols.push({
                    name: enumMatch[1],
                    kind: 'enum',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                })
                continue
            }

            const implMatch = line.match(/^\s*impl\s+(?:<[^>]*>\s*)?(\w+)/)
            if (implMatch) {
                symbols.push({
                    name: implMatch[1],
                    kind: 'class',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                })
            }
        }

        return symbols
    }

    private parseGoFile(filePath: string, content: string): SymbolInfo[] {
        const symbols: SymbolInfo[] = []
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const funcMatch = line.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/)
            if (funcMatch) {
                symbols.push({
                    name: funcMatch[1],
                    kind: 'function',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                    signature: line.trim(),
                })
                continue
            }

            const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/)
            if (typeMatch) {
                symbols.push({
                    name: typeMatch[1],
                    kind: typeMatch[2] === 'interface' ? 'interface' : 'class',
                    file: filePath,
                    lineStart: i + 1,
                    lineEnd: i + 1,
                })
            }
        }

        return symbols
    }

    private rebuildNameIndex(): void {
        this.nameIndex.clear()
        for (const syms of this.symbols.values()) {
            for (const s of syms) {
                const existing = this.nameIndex.get(s.name) ?? []
                existing.push(s)
                this.nameIndex.set(s.name, existing)
            }
        }
    }
}
