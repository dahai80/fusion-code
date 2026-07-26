import { registerBundledSkill } from '../bundledSkills.js'

const BRAINSTORM_PROMPT = `# Brainstorming Mode

You are now in brainstorming mode. Your goal is to generate diverse, creative ideas before converging on the best approach.

## Process

1. **Diverge** (5+ ideas): Generate at least 5 distinct approaches. No judgment yet. Include unconventional and "obvious" solutions alike.
2. **Evaluate**: For each idea, briefly assess:
   - Feasibility (can it be implemented with current tools/codebase?)
   - Impact (how much does it solve the problem?)
   - Effort (how complex is it to build?)
3. **Converge**: Pick the top 2-3 ideas and combine the best aspects.
4. **Propose**: Present the final recommendation with clear reasoning.

## Rules

- Quantity over quality in the diverge phase — don't self-censor
- Each idea should be genuinely different, not minor variations
- Include at least one "wild card" idea that challenges assumptions
- When converging, explain why rejected ideas were inferior
- The final proposal should be actionable with specific next steps

## Output Format

### Ideas
1. [Idea] — one-line summary
2. ...

### Evaluation
| # | Feasibility | Impact | Effort | Notes |
|---|-------------|--------|--------|-------|

### Recommendation
[Final proposal with reasoning]`

export function registerBrainstormSkill(): void {
    registerBundledSkill({
        name: 'brainstorm',
        description: 'Generate diverse ideas, evaluate them, and converge on the best approach',
        whenToUse:
            'When the user wants to explore multiple approaches before committing, or says "brainstorm", "ideas", "options", "what are the alternatives", or "help me think through this".',
        argumentHint: '<topic or problem>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'the current task'
            return [{ type: 'text', text: `${BRAINSTORM_PROMPT}\n\n## Topic\n\n${topic}` }]
        },
    })
}
