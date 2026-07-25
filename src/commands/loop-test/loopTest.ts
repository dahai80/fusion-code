import { getCwd } from '../../utils/cwd.js'
import {
    selfCorrectLoop,
    buildSelfCorrectPrompt,
    detectTestCommand,
    type SelfCorrectConfig,
    type SelfCorrectResult,
} from '../../services/selfCorrect/selfCorrect.js'

const LOG_PREFIX = '[loop-test]'

function parseArgs(input: string): {
    testCommand: string | null
    maxIterations: number
    buildCommand: string | null
} {
    const parts = input.trim().split(/\s+/)
    let testCommand: string | null = null
    let maxIterations = 5
    let buildCommand: string | null = null
    const nonFlagParts: string[] = []

    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '--max' && parts[i + 1]) {
            const n = parseInt(parts[i + 1], 10)
            if (n > 0 && n <= 20) maxIterations = n
            i++
        } else if (parts[i] === '--build' && parts[i + 1]) {
            buildCommand = parts[i + 1]
            i++
        } else if (parts[i] && !parts[i].startsWith('--')) {
            nonFlagParts.push(parts[i])
        }
    }

    if (nonFlagParts.length > 0) {
        testCommand = nonFlagParts.join(' ')
    }

    return { testCommand, maxIterations, buildCommand }
}

export async function* handleLoopTestCommand(input: string) {
    const { testCommand: rawCmd, maxIterations, buildCommand } = parseArgs(input)
    const workingDir = getCwd()

    let testCommand = rawCmd
    if (!testCommand) {
        testCommand = detectTestCommand(workingDir)
        if (!testCommand) {
            yield {
                type: 'tool-result' as const,
                result: [
                    '❌ No test command detected.',
                    '',
                    'Usage: /loop-test <test-command> [--max N] [--build cmd]',
                    '',
                    'Examples:',
                    '  /loop-test npm test',
                    '  /loop-test pytest --max 10',
                    '  /loop-test cargo test --build "cargo build"',
                    '',
                    'Auto-detection supports: npm test, pytest, make test, cargo test',
                ].join('\n'),
            }
            return
        }
        console.log(`${LOG_PREFIX} auto-detected test command: ${testCommand}`)
    }

    const config: SelfCorrectConfig = {
        testCommand,
        maxIterations,
        workingDir,
        ...(buildCommand ? { buildCommand } : {}),
    }

    yield {
        type: 'tool-result' as const,
        result: [
            `🔄 Self-correction loop starting...`,
            `   Test: ${testCommand}`,
            `   Max iterations: ${maxIterations}`,
            ...(buildCommand ? [`   Build: ${buildCommand}`] : []),
            `   Working dir: ${workingDir}`,
        ].join('\n'),
    }

    const result: SelfCorrectResult = selfCorrectLoop(config)

    const prompt = buildSelfCorrectPrompt(result)

    yield {
        type: 'tool-result' as const,
        result: prompt,
    }
}
