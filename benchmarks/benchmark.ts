import { existsSync, statSync, writeFileSync } from 'fs'

const REPO_ROOT = import.meta.dir + '/..'
const BINARY_PATH = REPO_ROOT + '/fusion-code'
const RESULTS_PATH = import.meta.dir + '/results.json'
const MLX_BASE_URL = process.env.FUSION_GATEWAY_URL || process.env.FUSION_MLX_BASE_URL || 'http://127.0.0.1:11432'
const VERSION_RUNS = 5
const BUILD_TIMEOUT_MS = 600_000

interface TimingResult {
    avg: number
    min: number
    max: number
    runs: number[]
}

interface BenchmarkResults {
    timestamp: string
    version: string
    binaryPath: string
    startupTime: TimingResult | null
    buildTime: { ms: number; success: boolean } | null
    binarySize: { bytes: number; mb: string } | null
    mlxInference: {
        available: boolean
        model: string | null
        firstTokenMs: number | null
        totalMs: number | null
        error: string | null
    } | null
}

function nowMs(): number {
    return performance.now()
}

function msToHuman(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(1)} ms`
    return `${(ms / 1000).toFixed(2)} s`
}

function bytesToHuman(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function measureStartupTime(): TimingResult | null {
    if (!existsSync(BINARY_PATH)) {
        console.log('[startup] binary not found at ' + BINARY_PATH + ', skipping')
        return null
    }
    console.log(`[startup] running ./fusion-code --version x${VERSION_RUNS} ...`)
    const runs: number[] = []
    for (let i = 0; i < VERSION_RUNS; i++) {
        const start = nowMs()
        const proc = Bun.spawnSync({
            cmd: [BINARY_PATH, '--version'],
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const elapsed = nowMs() - start
        if (proc.exitCode !== 0) {
            console.log(`[startup] run ${i + 1} failed (exit ${proc.exitCode}), skipping this run`)
            continue
        }
        runs.push(elapsed)
        console.log(`[startup] run ${i + 1}: ${msToHuman(elapsed)}`)
    }
    if (runs.length === 0) {
        console.log('[startup] all runs failed, returning null')
        return null
    }
    const avg = runs.reduce((a, b) => a + b, 0) / runs.length
    const min = Math.min(...runs)
    const max = Math.max(...runs)
    console.log(`[startup] avg=${msToHuman(avg)} min=${msToHuman(min)} max=${msToHuman(max)}`)
    return { avg, min, max, runs }
}

function measureBuildTime(): { ms: number; success: boolean } | null {
    console.log('[build] running bun run build ...')
    const start = nowMs()
    const proc = Bun.spawnSync({
        cmd: ['bun', 'run', 'build'],
        cwd: REPO_ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
        timeout: BUILD_TIMEOUT_MS,
    })
    const elapsed = nowMs() - start
    const success = proc.exitCode === 0
    if (success) {
        console.log(`[build] success in ${msToHuman(elapsed)}`)
    } else {
        console.log(`[build] failed (exit ${proc.exitCode}) after ${msToHuman(elapsed)}`)
    }
    return { ms: elapsed, success }
}

function measureBinarySize(): { bytes: number; mb: string } | null {
    if (!existsSync(BINARY_PATH)) {
        console.log('[size] binary not found, skipping')
        return null
    }
    const stat = statSync(BINARY_PATH)
    const mb = bytesToHuman(stat.size)
    console.log(`[size] ${BINARY_PATH} = ${mb} (${stat.size} bytes)`)
    return { bytes: stat.size, mb }
}

async function checkMlxAvailable(): Promise<boolean> {
    try {
        const resp = await fetch(`${MLX_BASE_URL}/v1/models`, {
            signal: AbortSignal.timeout(3000),
        })
        if (!resp.ok) return false
        return true
    } catch {
        return false
    }
}

async function getMlxModel(): Promise<string | null> {
    try {
        const resp = await fetch(`${MLX_BASE_URL}/v1/models`, {
            signal: AbortSignal.timeout(5000),
        })
        if (!resp.ok) return null
        const data = await resp.json() as any
        const models = data?.data
        if (Array.isArray(models) && models.length > 0) {
            return models[0]?.id ?? null
        }
        return null
    } catch {
        return null
    }
}

async function measureMlxInference(model: string): Promise<{
    firstTokenMs: number | null
    totalMs: number | null
    error: string | null
}> {
    console.log(`[mlx] sending streaming chat request (model=${model}) ...`)
    const reqStart = nowMs()
    let firstTokenMs: number | null = null
    try {
        const resp = await fetch(`${MLX_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Say hello in one word.' }],
                stream: true,
                max_tokens: 16,
            }),
            signal: AbortSignal.timeout(120_000),
        })
        if (!resp.ok || !resp.body) {
            const totalMs = nowMs() - reqStart
            return { firstTokenMs: null, totalMs, error: `HTTP ${resp.status}` }
        }
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith('data:')) continue
                const payload = trimmed.slice(5).trim()
                if (payload === '[DONE]') continue
                if (firstTokenMs === null) {
                    firstTokenMs = nowMs() - reqStart
                    console.log(`[mlx] first token: ${msToHuman(firstTokenMs)}`)
                }
            }
        }
        const totalMs = nowMs() - reqStart
        console.log(`[mlx] total: ${msToHuman(totalMs)}`)
        return { firstTokenMs, totalMs, error: null }
    } catch (err) {
        const totalMs = nowMs() - reqStart
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`[mlx] error: ${msg}`)
        return { firstTokenMs, totalMs, error: msg }
    }
}

function getBinaryVersion(): string {
    try {
        const proc = Bun.spawnSync({
            cmd: [BINARY_PATH, '--version'],
            cwd: REPO_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        if (proc.exitCode === 0) {
            return new TextDecoder().decode(proc.stdout).trim()
        }
    } catch {}
    return 'unknown'
}

function printTable(results: BenchmarkResults): void {
    console.log('')
    console.log('=== Benchmark Results ===')
    console.log('')
    console.log(`  Timestamp:    ${results.timestamp}`)
    console.log(`  Version:      ${results.version}`)
    console.log(`  Binary:       ${results.binaryPath}`)
    console.log('')

    if (results.startupTime) {
        const st = results.startupTime
        console.log('  [Startup Time]')
        console.log(`    avg:  ${msToHuman(st.avg)}`)
        console.log(`    min:  ${msToHuman(st.min)}`)
        console.log(`    max:  ${msToHuman(st.max)}`)
        console.log(`    runs: ${st.runs.map(r => r.toFixed(0)).join(', ')} ms`)
        console.log('')
    }

    if (results.buildTime) {
        console.log('  [Build Time]')
        console.log(`    time:    ${msToHuman(results.buildTime.ms)}`)
        console.log(`    success: ${results.buildTime.success}`)
        console.log('')
    }

    if (results.binarySize) {
        console.log('  [Binary Size]')
        console.log(`    size: ${results.binarySize.mb}`)
        console.log(`    bytes: ${results.binarySize.bytes}`)
        console.log('')
    }

    if (results.mlxInference) {
        const mlx = results.mlxInference
        console.log('  [MLX Inference]')
        console.log(`    available:    ${mlx.available}`)
        console.log(`    model:        ${mlx.model ?? 'n/a'}`)
        console.log(`    firstToken:   ${mlx.firstTokenMs !== null ? msToHuman(mlx.firstTokenMs) : 'n/a'}`)
        console.log(`    total:        ${mlx.totalMs !== null ? msToHuman(mlx.totalMs) : 'n/a'}`)
        if (mlx.error) console.log(`    error:        ${mlx.error}`)
        console.log('')
    }

    console.log(`  Results written to: ${RESULTS_PATH}`)
    console.log('')
}

async function main(): Promise<void> {
    console.log('=== fusion-code benchmark ===')
    console.log(`Repo: ${REPO_ROOT}`)
    console.log(`Time: ${new Date().toISOString()}`)
    console.log('')

    const version = getBinaryVersion()
    console.log(`[info] binary version: ${version}`)

    const results: BenchmarkResults = {
        timestamp: new Date().toISOString(),
        version,
        binaryPath: BINARY_PATH,
        startupTime: null,
        buildTime: null,
        binarySize: null,
        mlxInference: null,
    }

    try {
        results.startupTime = measureStartupTime()
    } catch (err) {
        console.log(`[startup] unexpected error: ${err}`)
    }

    try {
        results.buildTime = measureBuildTime()
    } catch (err) {
        console.log(`[build] unexpected error: ${err}`)
    }

    try {
        results.binarySize = measureBinarySize()
    } catch (err) {
        console.log(`[size] unexpected error: ${err}`)
    }

    try {
        const available = await checkMlxAvailable()
        if (!available) {
            console.log('[mlx] port 11432 not responding, skipping inference benchmark')
            results.mlxInference = {
                available: false,
                model: null,
                firstTokenMs: null,
                totalMs: null,
                error: 'port 11432 not listening',
            }
        } else {
            console.log('[mlx] port 11432 is listening, probing model ...')
            const model = await getMlxModel()
            if (!model) {
                console.log('[mlx] no model found, skipping inference')
                results.mlxInference = {
                    available: true,
                    model: null,
                    firstTokenMs: null,
                    totalMs: null,
                    error: 'no model available',
                }
            } else {
                const inference = await measureMlxInference(model)
                results.mlxInference = {
                    available: true,
                    model,
                    ...inference,
                }
            }
        }
    } catch (err) {
        console.log(`[mlx] unexpected error: ${err}`)
        results.mlxInference = {
            available: false,
            model: null,
            firstTokenMs: null,
            totalMs: null,
            error: String(err),
        }
    }

    try {
        writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n')
        console.log(`[output] wrote ${RESULTS_PATH}`)
    } catch (err) {
        console.log(`[output] failed to write results.json: ${err}`)
    }

    printTable(results)
}

main().catch((err) => {
    console.error('Benchmark failed:', err)
    process.exit(1)
})
