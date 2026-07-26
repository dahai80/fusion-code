import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'

export interface DevServerInfo {
    framework: string
    port: number
    command: string
    errorPattern: RegExp
}

const FRAMEWORK_CONFIGS: Record<string, Partial<DevServerInfo>> = {
    'vite': { framework: 'vite', port: 5173, command: 'npm run dev', errorPattern: /\[vite\]\s*(error|warn)/i },
    'next': { framework: 'next.js', port: 3000, command: 'npm run dev', errorPattern: /(Error|Unhandled|NEXT_)/i },
    'nuxt': { framework: 'nuxt', port: 3000, command: 'npm run dev', errorPattern: /(ERROR|WARN|Nuxt)/i },
    'sveltekit': { framework: 'sveltekit', port: 5173, command: 'npm run dev', errorPattern: /(Error|warn)/i },
    'astro': { framework: 'astro', port: 4321, command: 'npm run dev', errorPattern: /(Error|astro)/i },
    'angular': { framework: 'angular', port: 4200, command: 'npm start', errorPattern: /(ERROR|warning)/i },
    'remix': { framework: 'remix', port: 3000, command: 'npm run dev', errorPattern: /(Error|🚨)/i },
    'rails': { framework: 'rails', port: 3000, command: 'bundle exec rails server', errorPattern: /(Error|FATAL)/i },
    'django': { framework: 'django', port: 8000, command: 'python manage.py runserver', errorPattern: /(ERROR|Exception)/i },
    'flask': { framework: 'flask', port: 5000, command: 'flask run', errorPattern: /(Error|Traceback)/i },
}

export function detectDevServer(projectDir: string): DevServerInfo | null {
    const pkgPath = join(projectDir, 'package.json')

    if (existsSync(join(projectDir, 'manage.py'))) {
        return { framework: 'django', port: 8000, command: 'python manage.py runserver', errorPattern: /(ERROR|Exception)/i }
    }
    if (existsSync(join(projectDir, 'app.py')) || existsSync(join(projectDir, 'wsgi.py'))) {
        return { framework: 'flask', port: 5000, command: 'flask run', errorPattern: /(Error|Traceback)/i }
    }

    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }

            for (const [key, config] of Object.entries(FRAMEWORK_CONFIGS)) {
                const depNames = key === 'sveltekit' ? ['@sveltejs/kit'] : [key]
                if (depNames.some(d => deps[d])) {
                    const script = pkg.scripts?.dev ? 'npm run dev' : (config.command || 'npm start')
                    logForDebugging(`[dev-server] detected ${config.framework}`)
                    return {
                        framework: config.framework || key,
                        port: config.port || 3000,
                        command: script,
                        errorPattern: config.errorPattern || /Error/i,
                    }
                }
            }

            if (pkg.scripts?.dev) {
                logForDebugging('[dev-server] detected generic node project')
                return { framework: 'node', port: 3000, command: 'npm run dev', errorPattern: /Error/i }
            }
        } catch {
            // skip
        }
    }

    logForDebugging('[dev-server] no dev server detected')
    return null
}
