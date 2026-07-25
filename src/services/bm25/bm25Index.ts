import { readFile, readdir, stat } from 'fs/promises'
import { join, extname, relative } from 'path'
import { logEvent } from '../analytics/index.js'
import { isFusionMlxProvider } from '../../utils/model/providers.js'

const LOG_PREFIX = '[bm25]'

export interface BM25Result {
    file: string
    score: number
    snippet: string
    lineStart: number
    lineEnd: number
}

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or',
    'if', 'while', 'about', 'up', 'it', 'its', 'this', 'that', 'these',
    'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
    'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
])

const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py', '.rs', '.go', '.c', '.h', '.cpp', '.hpp', '.cc',
    '.java', '.rb', '.swift', '.kt',
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
    '.css', '.scss', '.html', '.htm', '.vue', '.svelte',
    '.sh', '.bash', '.zsh', '.fish',
    '.sql', '.graphql',
    '.gitignore', '.env', '.conf', '.cfg', '.ini',
])

const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
    '.venv', 'venv', 'target', 'vendor', '.cache', '.codegraph',
])

const MAX_FILE_SIZE = 256 * 1024
const MAX_FILES = 3000
const MAX_SNIPPET_LINES = 8

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

function shouldIgnoreDir(name: string): boolean {
    return IGNORE_DIRS.has(name) || name.startsWith('.')
}

export class BM25Index {
    private rootDir: string
    private docCount = 0
    private avgDocLen = 0
    private docLens: Map<string, number> = new Map()
    private termFreqs: Map<string, Map<string, number>> = new Map()
    private docFreqs: Map<string, number> = new Map()
    private fileContents: Map<string, string> = new Map()
    private _initialized = false

    private readonly k1 = 1.2
    private readonly b = 0.75

    constructor(rootDir: string) {
        this.rootDir = rootDir
    }

    async init(): Promise<void> {
        if (this._initialized) return
        const start = Date.now()

        await this.indexDirectory(this.rootDir)

        const totalLen = Array.from(this.docLens.values()).reduce((a, b) => a + b, 0)
        this.avgDocLen = this.docCount > 0 ? totalLen / this.docCount : 0

        this._initialized = true
        const durationMs = Date.now() - start

        console.log(
            `${LOG_PREFIX} initialized: ${this.docCount} docs, avg len ${Math.round(this.avgDocLen)} tokens in ${durationMs}ms`,
        )

        logEvent('bm25_index', {
            docs: this.docCount,
            avg_len: Math.round(this.avgDocLen),
            duration_ms: durationMs,
            is_mlx: isFusionMlxProvider(),
        })
    }

    get initialized(): boolean {
        return this._initialized
    }

    search(query: string, topK = 10): BM25Result[] {
        if (!this._initialized) return []

        const queryTerms = tokenize(query)
        if (queryTerms.length === 0) return []

        const scores: Map<string, number> = new Map()

        for (const term of queryTerms) {
            const df = this.docFreqs.get(term) ?? 0
            if (df === 0) continue

            const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1)

            const tfMap = this.termFreqs.get(term)
            if (!tfMap) continue

            for (const [doc, tf] of tfMap) {
                const dl = this.docLens.get(doc) ?? 0
                const tfNorm = (tf * (this.k1 + 1)) /
                    (tf + this.k1 * (1 - this.b + this.b * (dl / this.avgDocLen)))

                const prev = scores.get(doc) ?? 0
                scores.set(doc, prev + idf * tfNorm)
            }
        }

        const ranked = Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, topK)

        return ranked.map(([doc, score]) => {
            const content = this.fileContents.get(doc) ?? ''
            const snippet = this.extractSnippet(content, queryTerms)
            const lineStart = this.findSnippetLine(content, snippet)
            return {
                file: doc,
                score: Math.round(score * 100) / 100,
                snippet,
                lineStart,
                lineEnd: lineStart + MAX_SNIPPET_LINES - 1,
            }
        })
    }

    private extractSnippet(content: string, queryTerms: string[]): string {
        const lines = content.split('\n')
        let bestLine = 0
        let bestScore = 0

        for (let i = 0; i < lines.length; i++) {
            const lineTokens = new Set(tokenize(lines[i]))
            const overlap = queryTerms.filter(t => lineTokens.has(t)).length
            if (overlap > bestScore) {
                bestScore = overlap
                bestLine = i
            }
        }

        const start = Math.max(0, bestLine - 2)
        const end = Math.min(lines.length, start + MAX_SNIPPET_LINES)
        return lines.slice(start, end).join('\n')
    }

    private findSnippetLine(content: string, snippet: string): number {
        const firstLine = snippet.split('\n')[0]
        const idx = content.indexOf(firstLine)
        if (idx < 0) return 1
        return content.slice(0, idx).split('\n').length
    }

    private async indexDirectory(dir: string, depth = 0): Promise<void> {
        if (depth > 10) return
        if (this.docCount >= MAX_FILES) return

        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }

        const tasks: Promise<void>[] = []

        for (const entry of entries) {
            if (this.docCount >= MAX_FILES) break

            const fullPath = join(dir, entry.name)

            if (entry.isDirectory()) {
                if (shouldIgnoreDir(entry.name)) continue
                tasks.push(this.indexDirectory(fullPath, depth + 1))
            } else if (entry.isFile()) {
                const ext = extname(entry.name)
                const baseName = entry.name.toLowerCase()
                if (TEXT_EXTENSIONS.has(ext) || baseName === 'makefile' || baseName === 'dockerfile') {
                    tasks.push(this.indexFile(fullPath))
                }
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
            const tokens = tokenize(content)

            this.fileContents.set(rel, content)
            this.docLens.set(rel, tokens.length)
            this.docCount++

            const termCounts = new Map<string, number>()
            for (const t of tokens) {
                termCounts.set(t, (termCounts.get(t) ?? 0) + 1)
            }

            for (const [term, count] of termCounts) {
                if (!this.termFreqs.has(term)) {
                    this.termFreqs.set(term, new Map())
                }
                this.termFreqs.get(term)!.set(rel, count)
                this.docFreqs.set(term, (this.docFreqs.get(term) ?? 0) + 1)
            }
        } catch {
            // skip unreadable files
        }
    }
}
