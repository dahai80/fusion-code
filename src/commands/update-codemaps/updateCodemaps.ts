import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const UPDATE_CODEMAPS_PROMPT = `# Update Codemaps

Analyze the codebase structure and generate token-lean architecture documentation.

## Step 1: Scan Project Structure

1. Identify the project type (monorepo, single app, library, microservice)
2. Find all source directories (src/, lib/, app/, packages/)
3. Map entry points (main.ts, index.ts, app.py, main.go, etc.)

## Step 2: Generate Codemaps

Create or update codemaps in \`docs/CODEMAPS/\` (or \`.reports/codemaps/\`):

| File | Contents |
|------|----------|
| \`architecture.md\` | High-level system diagram, service boundaries, data flow |
| \`backend.md\` | API routes, middleware chain, service → repository mapping |
| \`frontend.md\` | Page tree, component hierarchy, state management flow |
| \`data.md\` | Database tables, relationships, migration history |
| \`dependencies.md\` | External services, third-party integrations, shared libraries |

## Codemap Format

Each codemap should be token-lean — optimized for AI context consumption:

\`\`\`markdown
# Backend Architecture

## Routes
POST /api/users → UserController.create → UserService.create → UserRepo.insert
GET  /api/users/:id → UserController.get → UserService.findById → UserRepo.findById

## Key Files
src/services/user.ts (business logic, 120 lines)
src/repos/user.ts (database access, 80 lines)
\`\`\`

## Rules

- Use arrow notation for call flows (A → B → C)
- Include line counts for key files
- Keep each codemap under 200 lines
- Focus on structure, not implementation details
- Update only the codemaps that changed`

export const call: LocalCommandCall = async (args, context) => {
    const section = args.trim() || 'all'
    console.log(`[update-codemaps] generating ${section} codemaps`)

    return {
            type: 'display',
        display: UPDATE_CODEMAPS_PROMPT,
    } satisfies LocalCommandResult
}
