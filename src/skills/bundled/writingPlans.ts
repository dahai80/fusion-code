import { registerBundledSkill } from '../bundledSkills.js'

const WRITING_PLANS_PROMPT = `# PRP — Prompt-Rich Plan

You are now in planning mode with the PRP methodology. Produce a self-contained implementation plan that captures all codebase patterns, conventions, and context needed to implement in a single pass.

**Golden Rule**: If you would need to search the codebase during implementation, capture that knowledge NOW in the plan.

## Phase 0 — DETECT

Determine input type:

| Input Pattern | Detection | Action |
|---|---|---|
| Path ending in \`.prd.md\` | File path to PRD | Parse PRD, find next pending phase |
| Free-form text | Feature description | Proceed to Phase 1 |
| Empty | No input | Ask user what to plan |

## Phase 1 — ANALYZE CODEBASE

Before writing any plan, understand the existing patterns:

1. **Stack detection**: Identify package manager, framework, language
   - \`bun.lockb\` → bun, \`pnpm-lock.yaml\` → pnpm, \`package-lock.json\` → npm
   - \`Cargo.toml\` → Rust, \`go.mod\` → Go, \`pyproject.toml\` → Python
2. **Available scripts**: Check \`package.json\` scripts or Makefile for build/test/lint commands
3. **Conventions**: Read CLAUDE.md, .editorconfig, tsconfig, eslint config
4. **Pattern extraction**: Find 2-3 examples of similar features already in the codebase. Note:
   - File naming conventions
   - Import patterns
   - Error handling approach
   - Testing patterns
5. **Entry points**: Where does the codebase wire things up? (index files, registries, routers)

## Phase 2 — WRITE THE PLAN

Every plan must include:

### Goal
One clear sentence describing the end state.

### Context
- What exists now (related files, modules, APIs)
- What constraints apply (performance, compatibility, dependencies)
- What decisions are already made

### Codebase Patterns Captured
- Naming convention: [from Phase 1]
- Import style: [from Phase 1]
- Error handling pattern: [from Phase 1]
- Test pattern: [from Phase 1]
- Registration/wiring: [where new code plugs in]

### Steps
Numbered, ordered implementation steps. Each step includes:
- **Action**: What to do (imperative verb)
- **Files**: Which files to create/modify (exact paths)
- **Pattern to follow**: Reference to existing code that does something similar
- **Depends on**: Step # or "none"
- **Verify**: How to confirm it works (command to run, manual check)
- **⚠️ Risk**: If risky, state what could go wrong

Rules for steps:
- Steps must be atomic — each step leaves the codebase in a working state
- Include the exact code to write or a precise description with pattern reference
- Prefer small steps over large ones — 10 clear steps > 3 vague ones
- Mark risky steps explicitly with ⚠️

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

### Definition of Done
- [ ] Build passes: \`[exact build command]\`
- [ ] Tests pass: \`[exact test command]\`
- [ ] Manual verification: [specific check]

### Rollback
How to undo if things go sideways (git commands, files to delete, etc.)

## Phase 3 — VALIDATE THE PLAN

Before presenting, self-check:
1. Can each step be implemented without searching the codebase? (patterns captured?)
2. Does every step have verification criteria?
3. Are file paths exact, not vague like "the appropriate file"?
4. Is the step order correct (dependencies before dependents)?
5. Would a developer new to this project be able to follow it?

## Anti-Patterns

- ❌ Vague steps like "update the relevant files"
- ❌ Missing pattern references (forces codebase search during implementation)
- ❌ No verification criteria per step
- ❌ Skipping codebase analysis and guessing conventions
- ❌ Plans that require asking questions during implementation

## Output Format

[Follow the structure from Phase 2 exactly]`

export function registerWritingPlansSkill(): void {
    registerBundledSkill({
        name: 'writing-plans',
        description: 'PRP methodology: analyze codebase patterns → write self-contained plan with pattern references → validate. No codebase search needed during implementation.',
        whenToUse:
            'When the user asks to "write a plan", "create an implementation plan", "plan this out", "PRP", or when a complex task needs structured decomposition before coding.',
        argumentHint: '<feature description or path/to/prd.md>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const task = args.trim() || 'the current task'
            return [{ type: 'text', text: `${WRITING_PLANS_PROMPT}\n\n## Task to Plan\n\n${task}` }]
        },
    })
}
