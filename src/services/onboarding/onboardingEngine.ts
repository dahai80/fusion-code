import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'

export interface OnboardingProfile {
    projectType: string
    framework: string
    language: string
    suggestedFeatures: string[]
    tips: string[]
}

export function detectProjectProfile(projectDir: string): OnboardingProfile {
    const profile: OnboardingProfile = {
        projectType: 'unknown',
        framework: 'none',
        language: 'unknown',
        suggestedFeatures: [],
        tips: [],
    }

    if (existsSync(join(projectDir, 'package.json'))) {
        profile.language = 'javascript/typescript'
        try {
            const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }

            if (deps.react) {
                profile.framework = 'react'
                profile.suggestedFeatures.push('/scaffold react-component')
                profile.tips.push('Use /preview to detect your Vite dev server')
            }
            if (deps.next) {
                profile.framework = 'next.js'
                profile.suggestedFeatures.push('/scaffold api-route')
                profile.tips.push('Use /deploy to configure Vercel deployment')
            }
            if (deps.vue) {
                profile.framework = 'vue'
                profile.suggestedFeatures.push('/scaffold vue-component')
            }
            if (deps.express || deps.fastify) {
                profile.framework = deps.fastify ? 'fastify' : 'express'
                profile.projectType = 'api-server'
                profile.suggestedFeatures.push('/scaffold api-endpoint')
            }
            if (deps.svelte) {
                profile.framework = 'svelte'
            }
            if (deps.astro) {
                profile.framework = 'astro'
            }

            if (profile.framework === 'none') {
                profile.framework = 'node'
            }
            profile.projectType = 'web-app'
        } catch {
            // skip
        }
    } else if (existsSync(join(projectDir, 'Cargo.toml'))) {
        profile.language = 'rust'
        profile.framework = 'cargo'
        profile.projectType = 'rust-project'
        profile.tips.push('Use /run to execute Rust snippets')
    } else if (existsSync(join(projectDir, 'go.mod'))) {
        profile.language = 'go'
        profile.framework = 'go'
        profile.projectType = 'go-project'
    } else if (existsSync(join(projectDir, 'pyproject.toml')) || existsSync(join(projectDir, 'requirements.txt'))) {
        profile.language = 'python'
        profile.projectType = 'python-project'
        if (existsSync(join(projectDir, 'manage.py'))) {
            profile.framework = 'django'
            profile.suggestedFeatures.push('/scaffold django-view')
        } else {
            profile.framework = 'python'
        }
        profile.tips.push('Use /run to execute Python snippets')
    }

    profile.suggestedFeatures.push('/memory-search to find saved context')
    profile.suggestedFeatures.push('/research for deep investigation')

    logForDebugging(`[onboarding] profile: ${profile.framework}/${profile.language}`)
    return profile
}
