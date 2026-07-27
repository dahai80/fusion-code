import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'

export type DeployPlatform = 'netlify' | 'vercel' | 'cloudflare' | 'github-pages' | 'unknown'

export interface DeployConfig {
    platform: DeployPlatform
    buildCommand: string
    outputDir: string
    envVars: string[]
    configFile: string | null
}

const PLATFORM_MARKERS: Record<string, DeployPlatform> = {
    'netlify.toml': 'netlify',
    'vercel.json': 'vercel',
    'wrangler.toml': 'cloudflare',
    'wrangler.json': 'cloudflare',
}

export function detectDeployPlatform(projectDir: string): DeployConfig {
    let platform: DeployPlatform = 'unknown'
    let configFile: string | null = null

    for (const [marker, pf] of Object.entries(PLATFORM_MARKERS)) {
        if (existsSync(join(projectDir, marker))) {
            platform = pf
            configFile = marker
            break
        }
    }

    const pkgPath = join(projectDir, 'package.json')
    let buildCommand = 'npm run build'
    let outputDir = 'dist'
    const envVars: string[] = []

    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
            if (pkg.scripts?.build) buildCommand = 'npm run build'
            if (pkg.scripts?.['build:prod']) buildCommand = 'npm run build:prod'

            if (pkg.dependencies?.next || pkg.devDependencies?.next) {
                if (platform === 'unknown') platform = 'vercel'
                outputDir = '.next'
                buildCommand = 'npm run build'
            }

            if (typeof pkg.claude === 'object' && pkg.claude.env) {
                envVars.push(...Object.keys(pkg.claude.env))
            }
        } catch {
            // skip
        }
    }

    if (platform === 'unknown') {
        if (existsSync(join(projectDir, '.github', 'workflows'))) {
            platform = 'github-pages'
            outputDir = 'out'
        }
    }

    logForDebugging(`[deploy] detected platform=${platform} build=${buildCommand} output=${outputDir}`)
    return { platform, buildCommand, outputDir, envVars, configFile }
}
