import { registerBundledSkill } from '../bundledSkills.js'

const TDD_PROMPT = `# Test-Driven Development

You are now in TDD mode. Follow the RED-GREEN-REFACTOR cycle strictly. No implementation code without a failing test first.

## The Iron Law

**You MUST write a failing test BEFORE writing any implementation code. No exceptions.**

The cycle is:

1. **RED** — Write a test that describes the desired behavior. Run it. It MUST fail. If it passes, the test is wrong or the feature already exists.
2. **GREEN** — Write the MINIMUM code to make the test pass. Nothing more. Hardcoded values are fine at this stage.
3. **REFACTOR** — Clean up the code while keeping all tests green. Improve names, remove duplication, simplify logic.

Then repeat for the next behavior.

## Rules

1. **Never write implementation without a failing test first**
2. **Only write enough test to fail** — one assertion per cycle when possible
3. **Only write enough code to pass** — fake it, then refactor to real
4. **Refactor only when green** — never refactor with a red test
5. **Run tests after every change** — immediate feedback loop
6. **Small steps** — one behavior at a time, not a whole feature

## Process

### Step 1: Identify the next behavior
- What should the code do next?
- What's the simplest case not yet covered?
- Write it as a test case name or description

### Step 2: RED — Write the failing test
\`\`\`
// Arrange: set up the test conditions
// Act: call the code under test
// Assert: verify the expected outcome
\`\`\`

Run the test. Confirm it FAILS. Read the failure message — it should describe what's missing.

### Step 3: GREEN — Make it pass
Write the simplest code that makes the test pass. This might be:
- Returning a constant
- A naive implementation
- Even a hack

The goal is to go from RED to GREEN as fast as possible.

### Step 4: REFACTOR — Clean up
With all tests GREEN:
- Remove duplication
- Improve naming
- Simplify logic
- Replace hardcoded values with real implementations
- Run tests after each refactoring step

### Step 5: Repeat
Go back to Step 1 for the next behavior.

## When to Apply

- New features: test the public API, not internals
- Bug fixes: write a test that reproduces the bug FIRST, then fix
- Refactoring: tests must exist before you refactor; if missing, write characterization tests first

## Anti-Patterns

- ❌ Writing implementation first, then retro-fitting tests
- ❌ Writing multiple tests before running any
- ❌ Skipping the refactor step (technical debt accumulates)
- ❌ Writing tests that are tightly coupled to implementation details
- ❌ Testing private methods instead of public behavior
- ❌ Large steps — trying to implement a whole feature in one cycle

## Output Format

### Current Cycle: [RED | GREEN | REFACTOR]

**Behavior being tested**: [one-line description]

**Test written**: [test name and key assertion]
**Result**: [PASS/FAIL + failure message if RED]

**Implementation**: [what code was added/changed]
**Result**: [PASS/FAIL]

**Refactoring**: [what was cleaned up, if anything]
**Result**: [PASS/FAIL]

**Next behavior**: [what to test next]`

export function registerTddSkill(): void {
    registerBundledSkill({
        name: 'tdd',
        description: 'Strict RED-GREEN-REFACTOR cycle. Write failing test first, minimum code to pass, then refactor. No implementation without a test.',
        whenToUse:
            'When implementing any feature or bugfix — especially before writing implementation code. Also use when the user says "tdd", "test first", "write tests first", or "red green refactor".',
        argumentHint: '<feature or behavior to implement>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'the current task'
            return [{ type: 'text', text: `${TDD_PROMPT}\n\n## Feature to Implement\n\n${topic}` }]
        },
    })
}
