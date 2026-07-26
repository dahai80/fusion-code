import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const UPDATE_DOCS_PROMPT = `# Update Documentation

Sync documentation with the codebase by generating from source-of-truth files.

## Step 1: Identify Sources of Truth

| Source | Generates |
|--------|-----------|
| \`package.json\` scripts | Available commands reference |
| \`.env.example\` | Environment variable documentation |
| \`openapi.yaml\` / route files | API endpoint reference |
| Source code exports | Public API documentation |
| \`Dockerfile\` / \`docker-compose.yml\` | Infrastructure setup docs |

## Step 2: Generate Script Reference

1. Read \`package.json\` (or Makefile, Cargo.toml, pyproject.toml)
2. Extract all scripts/commands with their descriptions
3. Generate a reference table

## Step 3: Generate Environment Documentation

1. Read \`.env.example\` (or \`.env.template\`, \`.env.sample\`)
2. Extract all variables with their purposes
3. Categorize as required vs optional

## Step 4: Generate API Reference (if applicable)

1. Scan route files or OpenAPI spec
2. List all endpoints with method, path, description

## Step 5: Write Updated Docs

1. Find existing documentation files (README.md, docs/, etc.)
2. Update only the sections that changed
3. Preserve manual content that has no source-of-truth
4. Mark auto-generated sections with \`<!-- auto-generated -->\` comments

## Rules

- Never delete manual documentation that has no source-of-truth
- Preserve the existing doc structure and style
- Mark auto-generated sections clearly
- Only update sections where the source-of-truth differs from the docs`

export const call: LocalCommandCall = async (_args, context) => {
    const cwd = context.cwd || process.cwd()
    console.log(`[update-docs] scanning ${cwd} for documentation sync targets`)

    return {
        display: UPDATE_DOCS_PROMPT,
    } satisfies LocalCommandResult
}
