import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'

const MAX_FILE_SIZE = 32_768
const MAX_MANIFEST_FILES = 8

interface ProjectManifest {
    path: string
    content: string
}

const MANIFEST_FILES = [
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    '.gitignore',
    '.dockerignore',
    'Makefile',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
] as const

const ALL_LINT_CONFIGS = new Set([
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
])

export async function readProjectManifests(
    cwd?: string,
): Promise<ProjectManifest[]> {
    const root = cwd || getCwd()
    const results: ProjectManifest[] = []

    const seenCategories = new Set<string>()

    for (const filename of MANIFEST_FILES) {
        if (results.length >= MAX_MANIFEST_FILES) break

        const category = getFileCategory(filename)
        if (seenCategories.has(category) && category !== 'other') continue
        seenCategories.add(category)

        const filePath = join(root, filename)
        try {
            if (!existsSync(filePath)) continue

            const stat = await readFile(filePath, 'utf-8')
            const content = stat.length > MAX_FILE_SIZE
                ? stat.slice(0, MAX_FILE_SIZE) + '\n... (truncated)'
                : stat

            results.push({ path: filename, content })
            logForDebugging(`[ProjectContext] loaded: ${filename}`)
        } catch (err) {
            logForDebugging(
                `[ProjectContext] failed to read ${filename}: ${(err as Error).message}`,
            )
        }
    }

    return results
}

function getFileCategory(filename: string): string {
    if (filename === 'package.json') return 'package'
    if (filename === 'tsconfig.json' || filename === 'jsconfig.json')
        return 'tsconfig'
    if (ALL_LINT_CONFIGS.has(filename)) return 'eslint'
    if (filename.startsWith('.prettier')) return 'prettier'
    if (
        filename === 'pyproject.toml' ||
        filename === 'Cargo.toml' ||
        filename === 'go.mod' ||
        filename === 'pom.xml' ||
        filename === 'build.gradle'
    )
        return 'build'
    if (filename === '.gitignore' || filename === '.dockerignore')
        return 'ignore'
    if (filename.startsWith('docker-compose') || filename === 'Dockerfile')
        return 'docker'
    return 'other'
}

export async function getProjectContextSection(
    cwd?: string,
): Promise<string | null> {
    const manifests = await readProjectManifests(cwd)
    if (manifests.length === 0) return null

    const lines: string[] = ['# Project Configuration']

    for (const m of manifests) {
        lines.push(`## ${m.path}`)
        lines.push('```')
        const trimmed = m.content.trimEnd()
        lines.push(trimmed)
        lines.push('```')
        lines.push('')
    }

    return lines.join('\n')
}

export async function getCompactProjectContext(
    cwd?: string,
): Promise<string | null> {
    const manifests = await readProjectManifests(cwd)
    if (manifests.length === 0) return null

    const lines: string[] = []

    for (const m of manifests) {
        if (m.path === 'package.json') {
            try {
                const pkg = JSON.parse(m.content)
                const parts: string[] = []
                if (pkg.name) parts.push(`name: ${pkg.name}`)
                if (pkg.version) parts.push(`version: ${pkg.version}`)
                if (pkg.type) parts.push(`type: ${pkg.type}`)
                if (pkg.main) parts.push(`main: ${pkg.main}`)
                const deps = Object.keys(pkg.dependencies || {})
                if (deps.length > 0) parts.push(`deps: ${deps.slice(0, 15).join(', ')}${deps.length > 15 ? '...' : ''}`)
                const devDeps = Object.keys(pkg.devDependencies || {})
                if (devDeps.length > 0) parts.push(`devDeps: ${devDeps.slice(0, 15).join(', ')}${devDeps.length > 15 ? '...' : ''}`)
                if (pkg.scripts) {
                    const scriptNames = Object.keys(pkg.scripts)
                    parts.push(`scripts: ${scriptNames.join(', ')}`)
                }
                lines.push(`package.json → ${parts.join(' | ')}`)
            } catch {
                lines.push(`package.json → (unparseable)`)
            }
        } else if (m.path === 'tsconfig.json' || m.path === 'jsconfig.json') {
            try {
                const ts = JSON.parse(m.content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
                const opts = ts.compilerOptions || {}
                const keys = Object.keys(opts).slice(0, 10)
                lines.push(`${m.path} → ${keys.map(k => `${k}: ${JSON.stringify(opts[k])}`).join(', ')}`)
            } catch {
                lines.push(`${m.path} → (unparseable)`)
            }
        } else if (m.path === '.gitignore') {
            const entries = m.content
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && !l.startsWith('#'))
                .slice(0, 15)
            lines.push(`.gitignore → ${entries.join(', ')}`)
        } else {
            const preview = m.content.split('\n').slice(0, 5).join(' ')
            const truncated = preview.length > 200 ? preview.slice(0, 200) + '...' : preview
            lines.push(`${m.path} → ${truncated}`)
        }
    }

    return `# Project Config\n${lines.join('\n')}`
}
