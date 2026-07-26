import { registerBundledSkill } from '../bundledSkills.js'

const SYSTEMATIC_DEBUGGING_PROMPT = `# Systematic Debugging

You are now in systematic debugging mode. Follow a rigorous 4-phase methodology to find and fix root causes. NEVER skip phases or jump to solutions.

## Phase 1: REPRODUCE

Before touching any code, you MUST reproduce the bug reliably.

1. Gather exact reproduction steps from the user or error logs
2. Create the minimal conditions that trigger the issue
3. Verify the bug occurs consistently
4. Document the expected vs actual behavior

**Gate**: Can you reproduce the bug at will? If NO → gather more info, do NOT proceed.

## Phase 2: ISOLATE

Narrow down the root cause systematically.

1. **Binary search**: Comment out / disable half the code path, check if bug persists
2. **Log strategically**: Add targeted log statements at decision points, NOT blanket logging
3. **Check assumptions**: Verify inputs, state, and configuration at each step
4. **Eliminate variables**: Test with different inputs, environments, configs to find what matters
5. **Trace the data**: Follow the data flow from input to output, find where it diverges

Common isolation patterns:
- "It works locally but not in production" → environment diff (env vars, config, data)
- "It works sometimes" → race condition, timing, or state-dependent
- "It worked before" → bisect git history to find the breaking change

**Gate**: Can you point to the specific line/function/state that causes the bug? If NO → keep isolating.

## Phase 3: FIX

Only now implement the fix.

1. Write the minimal fix that addresses the root cause (NOT symptoms)
2. Verify the fix resolves the reproduction case from Phase 1
3. Check for similar occurrences elsewhere in the codebase
4. Consider edge cases the fix might introduce

Rules:
- Fix the ROOT CAUSE, not the symptom
- Minimal changes — don't refactor adjacent code
- If the fix is complex, consider whether the diagnosis is wrong

## Phase 4: VERIFY

Prove the fix works and doesn't break anything.

1. Run the original reproduction case → should pass
2. Run existing tests → all should pass
3. Test edge cases near the fix
4. If possible, write a regression test that would catch this bug
5. Build the project → should succeed

**Gate**: All green? If NO → back to Phase 3.

## Anti-Patterns (NEVER do these)

- ❌ Guessing at fixes without reproducing
- ❌ Changing multiple things at once
- ❌ "Let me just try this" — random mutations
- ❌ Fixing symptoms instead of root causes
- ❌ Skipping the verify phase
- ❌ Assuming the bug is where the error message appears

## Output Format

### Phase 1: Reproduce
- Steps to reproduce:
- Expected:
- Actual:
- Consistently reproducible: Y/N

### Phase 2: Isolate
- Hypothesis:
- Binary search result:
- Root cause location:
- Why it happens:

### Phase 3: Fix
- Change made:
- Why this fixes it:
- Similar occurrences checked:

### Phase 4: Verify
- Reproduction case passes:
- Existing tests pass:
- Edge cases tested:
- Regression test added:`

export function registerSystematicDebuggingSkill(): void {
    registerBundledSkill({
        name: 'systematic-debugging',
        description: '4-phase root cause debugging: reproduce → isolate → fix → verify. Never skip phases or jump to solutions.',
        whenToUse:
            'When encountering any bug, test failure, or unexpected behavior — especially before proposing fixes. Also use when the user says "debug", "investigate", "figure out why", or "this is broken".',
        argumentHint: '<bug description or error>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'the current issue'
            return [{ type: 'text', text: `${SYSTEMATIC_DEBUGGING_PROMPT}\n\n## Bug to Debug\n\n${topic}` }]
        },
    })
}
