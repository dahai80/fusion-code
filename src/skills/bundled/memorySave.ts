import { registerBundledSkill } from '../bundledSkills.js'

const MEMORY_SAVE_PROMPT = `# Learn & Eval — Extract, Evaluate, then Save

You are now in learn-eval mode. Extract reusable patterns from the session, evaluate quality, decide save location, then persist to memory.

## What to Extract

1. **Error Resolution Patterns** — root cause + fix + reusability
2. **Debugging Techniques** — non-obvious steps, tool combinations that worked
3. **Workarounds** — library quirks, API limitations, version-specific fixes
4. **Project-Specific Patterns** — conventions, architecture decisions, integration patterns
5. **Configuration Gotchas** — non-obvious settings, env var interactions

## Process

### Step 1: Review the session

Scan the conversation for extractable patterns. Identify the most valuable/reusable insights.

### Step 2: Determine save location

Ask: "Would this pattern be useful in a different project?"

- **Global** (\`~/.claude/projects/<project>/memory/\`): Generic patterns usable across 2+ projects
  - Bash compatibility, LLM API behavior, debugging techniques
  - General tool combinations, cross-platform issues
- **Project** (\`.claude/memory/\` in current project): Project-specific knowledge
  - Quirks of a particular config file, project-specific architecture decisions
  - Internal API patterns, build system specifics

When in doubt, choose Project (moving Project → Global is easier than the reverse).

### Step 3: Quality gate before saving

For each candidate finding, evaluate:

| Criterion | Must be |
|-----------|---------|
| Non-obvious | NOT derivable from reading the code or git history |
| Cross-session | Useful in future conversations, not just this one |
| Actionable | Changes how you should work, not just trivia |
| Specific | Contains concrete details, not vague generalities |
| Verified | Confirmed working, not speculation |

If a finding fails any criterion → DON'T save it.

### Step 4: Write the memory file

\`\`\`markdown
---
name: <short-kebab-case-slug>
description: <one-line summary for relevance matching — under 130 chars>
metadata:
  type: user | feedback | project | reference
---

<the fact>
**Why:** <context that makes this non-obvious>
**How to apply:** <concrete guidance for future sessions>
\`\`\`

### Step 5: Update index

Add one-line pointer to MEMORY.md:
\`- [Title](file.md) — hook\`

### Step 6: Report

Tell the user what was saved and where.

## What NOT to Save

- Code structure (readable from the repo)
- Git history (available via git log)
- Temporary debugging state
- Things already in CLAUDE.md or project docs
- Speculation or unverified hypotheses

## Anti-Patterns

- ❌ Saving obvious facts ("the project uses TypeScript")
- ❌ Saving session-only context ("we discussed X at 2pm")
- ❌ Saving without verifying the finding is correct
- ❌ Duplicating existing memory files
- ❌ Vague descriptions that won't match in future`

export function registerMemorySaveSkill(): void {
    registerBundledSkill({
        name: 'memory-save',
        description: 'Extract reusable patterns from session → quality gate → decide save location (global vs project) → persist to memory',
        whenToUse:
            'When the user says "save to memory", "remember this", "learn from this", "persist this finding", or at the end of a significant work session to ensure key insights survive.',
        argumentHint: '[what to save]',
        userInvocable: true,
        async getPromptForCommand(args) {
            const focus = args.trim() || 'key findings from this session'
            return [{ type: 'text', text: `${MEMORY_SAVE_PROMPT}\n\n## Focus\n\n${focus}` }]
        },
    })
}
