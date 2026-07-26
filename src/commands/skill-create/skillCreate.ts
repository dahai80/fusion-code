import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

const SKILL_CREATE_PROMPT = `# Skill Create

Analyze the repository's git history to extract coding patterns and generate SKILL.md files.

## Step 1: Gather Git Data

\`\`\`bash
# Get recent commits with file changes
git log --oneline -n 200 --name-only --pretty=format:"%H|%s|%ad" --date=short

# Get commit frequency by file
git log --oneline -n 200 --name-only | sort | uniq -c | sort -rn | head -20

# Get commit message patterns
git log --oneline -n 200 | cut -d' ' -f2- | head -50
\`\`\`

## Step 2: Detect Patterns

Look for:

1. **Recurring workflows** — sequences of files that change together
2. **Naming conventions** — consistent prefixes, suffixes, or structures
3. **Error handling patterns** — how errors are caught, logged, reported
4. **Testing patterns** — test file location, naming, assertion style
5. **Build/deploy patterns** — common scripts, CI steps, deployment flow
6. **Code organization** — module boundaries, dependency direction

## Step 3: Generate SKILL.md

For each significant pattern cluster, create a skill file:

\`\`\`markdown
---
name: <pattern-name>
description: <one-line summary of when to use this skill>
user-invocable: false
origin: auto-extracted
---

# <Pattern Name>

## When This Applies
<conditions extracted from git history>

## Pattern
<step-by-step description>

## Examples from Codebase
<links to specific files/commits that demonstrate this pattern>

## Anti-Patterns
<what NOT to do, extracted from reverted commits or fixes>
\`\`\`

## Step 4: Output

- Write skill files to \`.claude/skills/learned/\` (project-scoped)
- Report what was generated with brief descriptions
- Suggest which skills might be worth promoting to user-invocable

## Rules

- Only extract patterns with 3+ occurrences in git history
- Include concrete file references, not vague descriptions
- Separate observations from recommendations
- Don't generate skills for trivial patterns (every project has them)`

export const call: LocalCommandCall = async (args, context) => {
    const commits = args.trim() || '200'
    console.log(`[skill-create] analyzing last ${commits} commits for patterns`)

    return {
        display: SKILL_CREATE_PROMPT,
    } satisfies LocalCommandResult
}
