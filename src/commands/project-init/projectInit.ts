import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const PROJECT_INIT_PROMPT = `# Project Init

Detect the project's technology stack and generate an onboarding configuration plan. Default to dry-run mode — only write files after explicit user approval.

## Step 1: Detect Stack

Scan the project root for signals:

- Package managers: \`package.json\`, \`bun.lockb\`, \`pnpm-lock.yaml\`, \`yarn.lock\`, \`package-lock.json\`
- Language manifests: \`pyproject.toml\`, \`requirements.txt\`, \`go.mod\`, \`Cargo.toml\`, \`pom.xml\`, \`build.gradle\`
- Framework files: \`next.config.*\`, \`vite.config.*\`, \`tailwind.config.*\`, \`Dockerfile\`, \`docker-compose.yml\`
- Existing config: \`CLAUDE.md\`, \`.claude/settings.local.json\`, \`.cursor/\`, \`.codex/\`

## Step 2: Generate Plan

Based on detected stack, propose:

1. **CLAUDE.md content** — project-specific guidance (commands, architecture, conventions)
2. **Settings** — allowed tools, permissions, MCP servers appropriate for the stack
3. **Hooks** (if applicable) — lint-on-save, format-on-write, test-on-commit
4. **Skills** — recommended bundled or custom skills for this stack

## Step 3: Safety Rules

1. Default to dry-run — show what would change without writing
2. Preserve existing files — propose merge/append, never overwrite
3. Keep permissions narrow — match detected build/test/lint tools
4. Report exactly what would change before applying

## Output Format

### Detected Stack
- Language:
- Framework:
- Package manager:
- Build tool:
- Test runner:
- Linter/formatter:

### Proposed Changes
| File | Action | Description |
|------|--------|-------------|

### Apply?
Confirm before writing any files.`

export const call: LocalCommandCall = async (args, context) => {
    const target = args.trim() || 'claude'
    console.log(`[project-init] detecting stack for ${target} onboarding`)

    return {
        display: PROJECT_INIT_PROMPT,
    } satisfies LocalCommandResult
}
