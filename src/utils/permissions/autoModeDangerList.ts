import { logForDebugging } from '../debug.js'

const AUTO_MODE_ASK_EXACT = new Set([
    'rm -rf',
    'rm -r',
    'rm -R',
    'rm -Rf',
    'rm -fr',
])

const AUTO_MODE_ASK_PREFIXES = [
    'sudo',
    'su',
    'doas',
    'git push',
    'git rm',
    'git reset --hard',
    'git reset -h',
    'git clean -f',
    'git clean -fd',
    'git clean -dfx',
    'git checkout --',
    'git restore',
    'ssh',
    'scp',
    'rsync',
    'docker rm',
    'docker rmi',
    'docker system prune',
    'docker volume prune',
    'docker network prune',
    'mkfs',
    'dd if=',
    'eval',
    'exec',
]

const AUTO_MODE_INTERPRETER_PREFIXES = [
    'python',
    'python3',
    'python2',
    'node',
    'deno',
    'tsx',
    'ruby',
    'perl',
    'php',
    'lua',
    'bash -c',
    'sh -c',
    'zsh -c',
    'fish -c',
]

const AUTO_MODE_HARD_DENY_PATTERNS: RegExp[] = [
    /\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/,
    /\bgit\s+stash[ \t]+(drop|clear)\b/,
    /\bgit\s+branch\s+(-D[ \t]|--delete\s+--force|--force\s+--delete)\b/,
    /\bkubectl\s+delete\b/,
    /\bterraform\s+destroy\b/,
    /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i,
    /\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i,
]

const AUTO_MODE_ALLOW_PREFIXES = [
    'ls',
    'cat',
    'head',
    'tail',
    'find',
    'grep',
    'egrep',
    'fgrep',
    'rg',
    'ag',
    'wc',
    'sort',
    'uniq',
    'diff',
    'which',
    'echo',
    'printf',
    'pwd',
    'env',
    'printenv',
    'file',
    'stat',
    'du',
    'df',
    'free',
    'top',
    'ps',
    'whoami',
    'id',
    'uname',
    'hostname',
    'date',
    'cal',
    'uptime',
    'test',
    'true',
    'false',
    'sleep',
    'mkdir',
    'touch',
    'cp',
    'mv',
    'chmod',
    'chown',
    'ln',
    'sed',
    'tar',
    'unzip',
    'git status',
    'git log',
    'git diff',
    'git branch',
    'git show',
    'git stash',
    'git stash list',
    'git stash pop',
    'git stash apply',
    'git tag',
    'git remote',
    'git config --get',
    'git blame',
    'git describe',
    'git rev-parse',
    'git shortlog',
    'git add',
    'git commit',
    'git checkout -b',
    'git switch',
    'git merge',
    'git pull',
    'git rebase',
    'git fetch',
    'npm test',
    'npm run',
    'npm install',
    'npm ci',
    'npm start',
    'npm rebuild',
    'bun test',
    'bun run',
    'bun install',
    'pip install',
    'pip3 install',
    'make',
    'cargo build',
    'cargo test',
    'cargo check',
    'cargo clippy',
    'go test',
    'go build',
    'go vet',
    'go mod',
    'pytest',
    'jest',
    'vitest',
    'eslint',
    'prettier',
    'biome',
    'tsc',
    'swift build',
    'swift test',
]

const READ_ONLY_BASE_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'find', 'grep', 'egrep', 'fgrep',
    'rg', 'ag', 'wc', 'sort', 'uniq', 'diff', 'which', 'echo',
    'printf', 'pwd', 'env', 'printenv', 'file', 'stat', 'du', 'df',
    'free', 'top', 'ps', 'whoami', 'id', 'uname', 'hostname', 'date',
    'cal', 'uptime', 'test', 'true', 'false', 'sleep',
])

const WRITE_CAPABLE_SUFFIXES = [
    ' > ', ' >> ', '>|', '&>', '>&', '2>',
]

const PIPE_TO_DESTRUCTIVE = [
    '| sh', '| bash', '| zsh', '| fish', '| python', '| python3', '| perl', '| ruby',
]

function matchesPrefix(command: string, prefixes: readonly string[]): boolean {
    const trimmed = command.trim()
    for (const prefix of prefixes) {
        if (trimmed === prefix || trimmed.startsWith(prefix + ' ')) {
            return true
        }
    }
    return false
}

export function isAutoModeHardDeny(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) return false
    for (const pattern of AUTO_MODE_HARD_DENY_PATTERNS) {
        if (pattern.test(trimmed)) {
            logForDebugging(`[auto-mode] hard deny (pattern): ${trimmed}`)
            return true
        }
    }
    return false
}

export function isAutoModeDangerousCommand(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) return false

    if (AUTO_MODE_ASK_EXACT.has(trimmed)) {
        logForDebugging(`[auto-mode] dangerous (exact match): ${trimmed}`)
        return true
    }

    if (matchesPrefix(trimmed, AUTO_MODE_ASK_PREFIXES)) {
        logForDebugging(`[auto-mode] dangerous (ask prefix): ${trimmed}`)
        return true
    }

    if (matchesPrefix(trimmed, AUTO_MODE_INTERPRETER_PREFIXES)) {
        logForDebugging(`[auto-mode] dangerous (interpreter): ${trimmed}`)
        return true
    }

    if (trimmed.startsWith('rm ')) {
        const rmArgs = trimmed.substring(3)
        if (rmArgs.match(/^-[rRf]/)) {
            logForDebugging(`[auto-mode] dangerous (rm flags): ${trimmed}`)
            return true
        }
    }

    return false
}

export function isAutoModeSafeCommand(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) return false

    if (matchesPrefix(trimmed, AUTO_MODE_ALLOW_PREFIXES)) {
        logForDebugging(`[auto-mode] safe (allow prefix): ${trimmed}`)
        return true
    }

    const base = trimmed.split(/\s+/)[0]
    if (READ_ONLY_BASE_COMMANDS.has(base)) {
        logForDebugging(`[auto-mode] safe (read-only base): ${base}`)
        return true
    }

    return false
}

export type ShellClassification = 'safe' | 'ask' | 'hard_deny'

export function classifyAllShell(command: string): ShellClassification {
    const trimmed = command.trim()
    if (!trimmed) return 'safe'

    if (isAutoModeHardDeny(trimmed)) return 'hard_deny'
    if (isAutoModeDangerousCommand(trimmed)) return 'ask'
    if (isAutoModeSafeCommand(trimmed)) return 'safe'

    for (const suffix of WRITE_CAPABLE_SUFFIXES) {
        if (trimmed.includes(suffix)) {
            logForDebugging(`[auto-mode] classify ask (write redirect): ${trimmed}`)
            return 'ask'
        }
    }

    for (const pipe of PIPE_TO_DESTRUCTIVE) {
        if (trimmed.includes(pipe)) {
            logForDebugging(`[auto-mode] classify ask (pipe to interpreter): ${trimmed}`)
            return 'ask'
        }
    }

    if (trimmed.includes('|') || trimmed.includes('&&') || trimmed.includes('||')) {
        logForDebugging(`[auto-mode] classify ask (compound command): ${trimmed}`)
        return 'ask'
    }

    const base = trimmed.split(/\s+/)[0]
    const likelyWriteCommands = new Set([
        'rm', 'rmdir', 'dd', 'mkfs', 'format', 'fdisk', 'parted',
        'curl', 'wget',
        'npm', 'npx', 'yarn', 'pnpm', 'bun',
        'pip', 'pip3', 'conda', 'brew', 'apt', 'yum', 'dnf', 'pacman',
        'docker', 'kubectl', 'helm', 'terraform', 'ansible',
        'systemctl', 'service', 'launchctl',
    ])
    if (likelyWriteCommands.has(base)) {
        logForDebugging(`[auto-mode] classify ask (write-capable base): ${base}`)
        return 'ask'
    }

    logForDebugging(`[auto-mode] classify ask (unclassified, default deny): ${trimmed}`)
    return 'ask'
}
