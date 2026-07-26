import { registerBundledSkill } from '../bundledSkills.js'

const WRITING_PLANS_PROMPT = `# Writing Plans Mode

You are now in writing-plans mode. Your goal is to produce a structured, actionable implementation plan.

## Plan Structure

Every plan must include:

1. **Goal**: One clear sentence describing the end state.
2. **Context**: What exists now, what constraints apply, what decisions are already made.
3. **Steps**: Numbered, ordered implementation steps. Each step includes:
   - What to do (imperative verb)
   - Which files/components are affected
   - Dependencies on previous steps
   - Verification criteria (how to know it's done)
4. **Risks**: What could go wrong and mitigations.
5. **Rollback**: How to undo if things go sideways.

## Rules

- Steps must be atomic — each step leaves the codebase in a working state
- Every step must have verification criteria (build passes, tests pass, manual check)
- Prefer small steps over large ones — 10 clear steps > 3 vague ones
- Mark risky steps explicitly with ⚠️
- If a step depends on a decision, state the default and the alternatives
- Include a "Definition of Done" at the end

## Output Format

### Goal
[One sentence]

### Context
[2-3 sentences of background]

### Steps
1. [Step title]
   - Action: [what to do]
   - Files: [affected files]
   - Depends on: [step # or "none"]
   - Verify: [how to check]

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

### Definition of Done
- [ ] [criterion 1]
- [ ] [criterion 2]

### Rollback
[How to undo]`

export function registerWritingPlansSkill(): void {
    registerBundledSkill({
        name: 'writing-plans',
        description: 'Produce structured, actionable implementation plans with steps, risks, and rollback',
        whenToUse:
            'When the user asks to "write a plan", "create an implementation plan", "plan this out", or when a complex task needs structured decomposition before coding.',
        argumentHint: '<feature or task>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const task = args.trim() || 'the current task'
            return [{ type: 'text', text: `${WRITING_PLANS_PROMPT}\n\n## Task\n\n${task}` }]
        },
    })
}
