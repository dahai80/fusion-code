import { registerBuiltinPlugin } from '../builtinPlugins.js'
import { logForDebugging } from '../../utils/debug.js'

export function registerGithubPlugin(): void {
    const hasToken = !!process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    if (!hasToken) {
        logForDebugging(
            '[Plugin:github] GITHUB_PERSONAL_ACCESS_TOKEN not set, plugin registered but MCP may fail to authenticate',
        )
    }
    registerBuiltinPlugin({
        name: 'github',
        description:
            'Official GitHub MCP server for repository management. Requires GITHUB_PERSONAL_ACCESS_TOKEN env var.',
        version: '1.0.0',
        mcpServers: hasToken
            ? {
                  github: {
                      type: 'http',
                      url: 'https://api.githubcopilot.com/mcp/',
                      headers: {
                          Authorization: `Bearer ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}`,
                      },
                  },
              }
            : undefined,
        isAvailable: () => true,
        defaultEnabled: hasToken,
    })
}
