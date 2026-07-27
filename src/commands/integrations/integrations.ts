import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

export const call: LocalCommandCall = async (args, _context) => {
    const action = args.trim().toLowerCase() || 'list'

    if (action === 'search') {
        return {
            type: 'text',
            value: [
                'Integration Search',
                '',
                'Search for MCP servers and plugins:',
                '  /integrations search <query>',
                '',
                'Categories:',
                '  - Database (PostgreSQL, MySQL, MongoDB, Redis)',
                '  - Cloud (AWS, GCP, Azure)',
                '  - VCS (GitHub, GitLab, Bitbucket)',
                '  - AI (OpenAI, Google AI, Cohere)',
                '  - DevOps (Docker, Kubernetes, Terraform)',
            ].join('\n'),
        } satisfies LocalCommandResult
    }

    if (action === 'add') {
        return {
            type: 'text',
            value: [
                'Add Integration',
                '',
                'Usage: /integrations add <name>',
                '',
                'This will:',
                '  1. Search the MCP registry',
                '  2. Download the server package',
                '  3. Configure in ~/.fusion-code/mcp.json',
                '  4. Restart the MCP connection',
            ].join('\n'),
        } satisfies LocalCommandResult
    }

    return {
        type: 'text',
        value: [
            'Integration Marketplace',
            '',
            'Commands:',
            '  /integrations list    — Show configured integrations',
            '  /integrations search — Search available integrations',
            '  /integrations add    — Install a new integration',
            '',
            'Also see:',
            '  /mcp       — Manage MCP server connections',
            '  /plugins   — Manage installed plugins',
        ].join('\n'),
    } satisfies LocalCommandResult
}
