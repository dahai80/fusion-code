import { execSync } from 'child_process'
import { logEvent } from '../analytics/index.js'
import { isFusionMlxProvider } from '../../utils/model/providers.js'

const LOG_PREFIX = '[selfCorrect]'

export interface SelfCorrectConfig {
    testCommand: string
    maxIterations: number
    workingDir: string
    buildCommand?: string
    timeoutMs?: number
}

export interface SelfCorrectResult {
    iterations: number
    passed: boolean
    lastError: string | null
    lastStdout: string | null
    history: Array<{
        iteration: number
        exitCode: number | null
        stderr: string
        stdout: string
    }>
}

interface ExecResult {
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
}

function runCommand(command: string, cwd: string, timeoutMs: number): ExecResult {
    try {
        const stdout = execSync(command, {
            cwd,
            timeout: timeoutMs,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        return { exitCode: 0, stdout, stderr: '', timedOut: false }
    } catch (err: any) {
        if (err.killed) {
            return { exitCode: null, stdout: '', stderr: `Command timed out after ${timeoutMs}ms`, timedOut: true }
        }
        return {
            exitCode: err.status ?? 1,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? '',
            timedOut: false,
        }
    }
}

function extractRelevantError(stderr: string, stdout: string): string {
    const combined = (stderr + '\n' + stdout).trim()
    if (!combined) return 'No output captured'

    const lines = combined.split('\n')
    const errorLines: string[] = []
    let foundError = false

    for (const line of lines) {
        const lower = line.toLowerCase()
        if (
            lower.includes('error') ||
            lower.includes('failed') ||
            lower.includes('fail:') ||
            lower.includes('assertion') ||
            lower.includes('traceback') ||
            lower.includes('uncaught') ||
            lower.includes('exception') ||
            lower.includes('cannot find') ||
            lower.includes('not found') ||
            lower.includes('typeerror') ||
            lower.includes('syntaxerror') ||
            lower.includes('referenceerror')
        ) {
            foundError = true
        }
        if (foundError) {
            errorLines.push(line)
        }
    }

    if (errorLines.length > 0) {
        const tail = errorLines.slice(-50)
        return tail.join('\n')
    }

    const tail = lines.slice(-30)
    return tail.join('\n')
}

export function selfCorrectLoop(config: SelfCorrectConfig): SelfCorrectResult {
    const {
        testCommand,
        maxIterations,
        workingDir,
        buildCommand,
        timeoutMs = 120_000,
    } = config

    const history: SelfCorrectResult['history'] = []
    let lastError: string | null = null
    let lastStdout: string | null = null
    let iteration = 0

    if (buildCommand) {
        const buildResult = runCommand(buildCommand, workingDir, timeoutMs)
        if (buildResult.exitCode !== 0) {
            const buildErr = extractRelevantError(buildResult.stderr, buildResult.stdout)
            console.log(`${LOG_PREFIX} build failed (exit ${buildResult.exitCode}): ${buildErr.slice(0, 200)}`)
            return {
                iterations: 0,
                passed: false,
                lastError: buildErr,
                lastStdout: buildResult.stdout,
                history: [{
                    iteration: 0,
                    exitCode: buildResult.exitCode,
                    stderr: buildResult.stderr,
                    stdout: buildResult.stdout,
                }],
            }
        }
    }

    for (iteration = 1; iteration <= maxIterations; iteration++) {
        console.log(`${LOG_PREFIX} iteration ${iteration}/${maxIterations}: ${testCommand}`)

        const result = runCommand(testCommand, workingDir, timeoutMs)

        history.push({
            iteration,
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
        })

        if (result.exitCode === 0) {
            console.log(`${LOG_PREFIX} PASSED on iteration ${iteration}`)
            logEvent('self_correct_success', {
                iterations: iteration,
                test_command: testCommand as unknown as number, // log: cast string to number for LogEventMetadata
                is_mlx: isFusionMlxProvider(),
            })
            return {
                iterations: iteration,
                passed: true,
                lastError: null,
                lastStdout: result.stdout,
                history,
            }
        }

        lastError = extractRelevantError(result.stderr, result.stdout)
        lastStdout = result.stdout
        console.log(`${LOG_PREFIX} iteration ${iteration} failed (exit ${result.exitCode}): ${lastError.slice(0, 200)}`)

        if (iteration < maxIterations) {
            console.log(`${LOG_PREFIX} feeding error back for self-correction...`)
        }
    }

    console.log(`${LOG_PREFIX} FAILED after ${maxIterations} iterations`)
    logEvent('self_correct_exhausted', {
        iterations: maxIterations,
        test_command: testCommand as unknown as number, // log: cast string to number for LogEventMetadata
        is_mlx: isFusionMlxProvider(),
    })

    return {
        iterations: maxIterations,
        passed: false,
        lastError,
        lastStdout,
        history,
    }
}

export function buildSelfCorrectPrompt(result: SelfCorrectResult): string {
    if (result.passed) {
        return `✅ Tests passed after ${result.iterations} iteration(s).`
    }

    const lastRun = result.history[result.history.length - 1]
    const parts = [
        `❌ Tests failed after ${result.iterations} iteration(s).`,
        '',
        `Exit code: ${lastRun?.exitCode ?? 'N/A'}`,
        '',
        '## Error output (last iteration):',
        '```',
        result.lastError ?? 'No error output captured',
        '```',
    ]

    if (result.iterations > 1) {
        const prevRun = result.history[result.history.length - 2]
        if (prevRun) {
            parts.push('')
            parts.push('## Previous iteration exit code:')
            parts.push(`${prevRun.exitCode ?? 'N/A'}`)
        }
    }

    parts.push('')
    parts.push('Fix the code to make the tests pass. Focus on the errors above.')

    return parts.join('\n')
}

export function detectTestCommand(workingDir: string): string | null {
    const fs = require('fs')
    const path = require('path')

    const pkgPath = path.join(workingDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
            const scripts = pkg.scripts ?? {}
            if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
                return 'npm test'
            }
            if (scripts['test:ci']) return 'npm run test:ci'
            if (scripts.check) return 'npm run check'
            if (scripts.lint && scripts['type-check']) return 'npm run lint && npm run type-check'
        } catch {}
    }

    const pyMarkers = ['pytest.ini', 'pyproject.toml', 'setup.cfg']
    for (const marker of pyMarkers) {
        const markerPath = path.join(workingDir, marker)
        if (fs.existsSync(markerPath)) {
            try {
                const content = fs.readFileSync(markerPath, 'utf-8')
                if (content.includes('pytest') || content.includes('[tool:pytest]')) {
                    return 'pytest'
                }
            } catch {}
        }
    }

    const makefilePath = path.join(workingDir, 'Makefile')
    if (fs.existsSync(makefilePath)) {
        try {
            const content = fs.readFileSync(makefilePath, 'utf-8')
            if (content.includes('test:')) return 'make test'
            if (content.includes('check:')) return 'make check'
        } catch {}
    }

    const cargoPath = path.join(workingDir, 'Cargo.toml')
    if (fs.existsSync(cargoPath)) return 'cargo test'

    return null
}
