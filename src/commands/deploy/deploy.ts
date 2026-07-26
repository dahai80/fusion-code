import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { detectDeployPlatform } from '../../services/deploy/index.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalCommandCall = async (args, _context) => {
    const env = args.trim() || 'production'
    const projectDir = getOriginalCwd()
    const config = detectDeployPlatform(projectDir)

    if (config.platform === 'unknown') {
        return {
            type: 'text',
            value: 'No deployment platform detected.\n\nSupported: Netlify, Vercel, Cloudflare, GitHub Pages.\nAdd a config file (netlify.toml, vercel.json, wrangler.toml) to enable auto-deploy.',
        } satisfies LocalCommandResult
    }

    return {
        type: 'text',
        value: `Deployment detected:\n  Platform: ${config.platform}\n  Build: ${config.buildCommand}\n  Output: ${config.outputDir}\n  Config: ${config.configFile || 'none'}\n  Env: ${env}\n\nTo deploy, run:\n  ${getDeployCommand(config.platform, env)}`,
    } satisfies LocalCommandResult
}

function getDeployCommand(platform: string, env: string): string {
    switch (platform) {
        case 'netlify': return env === 'staging' ? 'npx netlify deploy --build' : 'npx netlify deploy --prod --build'
        case 'vercel': return env === 'staging' ? 'npx vercel' : 'npx vercel --prod'
        case 'cloudflare': return 'npx wrangler deploy'
        case 'github-pages': return 'npx gh-pages -d dist'
        default: return 'npm run build && npm run deploy'
    }
}
