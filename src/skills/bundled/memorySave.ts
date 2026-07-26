import { registerBundledSkill } from '../bundledSkills.js'

const MEMORY_SAVE_PROMPT = `# Memory Persistence

You are now in memory-save mode. Persist important findings to the project memory so they survive across sessions.

## What to Save

Save things that are:
- **Non-obvious**: Not derivable from reading the code or git history
- **Cross-session**: Useful in future conversations, not just this one
- **Actionable**: Facts that change how you should work

## What NOT to Save

- Code structure (readable from the repo)
- Git history (available via git log)
- Temporary debugging state
- Things already in CLAUDE.md or project docs

## Memory File Format

Write to the memory directory with this structure:

\`\`\`markdown
---
name: <short-kebab-case-slug>
description: <one-line summary for relevance matching>
metadata:
  type: user | feedback | project | reference
---

<the fact>
**Why:** <context>
**How to apply:** <guidance>
\`\`\`

## Process

1. Identify the key findings from this session worth preserving.
2. For each finding, check if a memory file already covers it — update rather than duplicate.
3. Write new memory files for genuinely new information.
4. Update MEMORY.md index with one-line pointers to new files.
5. Report what was saved.

## Action

Now review this session and persist important findings.`

export function registerMemorySaveSkill(): void {
    registerBundledSkill({
        name: 'memory-save',
        description: 'Persist important findings to project memory for cross-session survival',
        whenToUse:
            'When the user says "save to memory", "remember this", "persist this finding", or at the end of a significant work session to ensure key insights survive.',
        argumentHint: '[what to save]',
        userInvocable: true,
        async getPromptForCommand(args) {
            const focus = args.trim() || 'key findings from this session'
            return [{ type: 'text', text: `${MEMORY_SAVE_PROMPT}\n\n## Focus\n\n${focus}` }]
        },
    })
}
