import type { Command } from '../../commands.js'
const scaffold = {
    type: 'prompt',
    name: 'scaffold',
    description: 'Scaffold a new project from a framework template',
    argumentHint: '<framework>',
    contentLength: 0,
    progressMessage: 'scaffolding project',
    source: 'builtin',
    async getPromptForCommand(args, _context) {
        const framework = args.trim() || 'detect'
        return `Scaffold a new project. Framework: ${framework}.

Detect the appropriate framework based on the current directory or user preference.
Supported frameworks: react, next.js, vue, nuxt, svelte, astro, express, fastify, django, flask, rails, go, rust.

Steps:
1. Detect or confirm the framework
2. Create the project structure with best-practice defaults
3. Include TypeScript config if applicable
4. Add basic test setup
5. Add README with usage instructions
6. Initialize git repo

Do NOT overwrite existing files without asking first.`
    },
} satisfies Command
export default scaffold
