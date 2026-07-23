export function getBugFixProtocol(): string {
    return `# Bug fix protocol

## Step 1: Reproduce

- Before ANY code change, confirm the bug exists.
- Read the error message or bug description carefully.
- If the user provides an error: read the stack trace, identify the file and line.
- If the user describes behavior: verify by running the relevant code or reading the relevant files.
- If you can't reproduce it, say so. Don't fix what you can't verify.

## Step 2: Locate root cause

- Follow the error trail: stack trace → function → caller → root cause.
- Read ONLY the files in the error path. Don't explore the entire codebase.
- Common root causes to check:
  - Null/undefined access (missing null check)
  - Off-by-one errors (< vs <=, 0-based vs 1-based)
  - Race conditions (async without await, shared mutable state)
  - Stale data (cached value not invalidated)
  - Type mismatch (string vs number, wrong API shape)
- Form ONE hypothesis. Test it. If wrong, form another. Don't guess randomly.

## Step 3: Fix

- Fix the ROOT CAUSE, not the symptom.
  - Symptom: add try/catch around the crash → WRONG
  - Root cause: fix the null value that caused the crash → RIGHT
- Minimal fix: change only what's necessary to fix the bug.
- Don't refactor surrounding code "while you're here".
- If the fix affects other callers, check them too.

## Step 4: Verify

- Run the reproduction case. Does it pass now?
- Run existing tests. Did you break anything?
- If you added code, consider: should there be a test for this?
- Check for the same bug pattern in other files.`
}

export function getFeatureImplementationProtocol(): string {
    return `# Feature implementation protocol

## Step 1: Understand requirements

- What is the feature supposed to do? Rephrase in your own words.
- What are the inputs? What are the expected outputs?
- Are there edge cases? Error cases? What should happen then?
- Is this replacing an existing feature or adding new functionality?

## Step 2: Explore existing code

- Find similar features in the codebase. Follow the same pattern.
- Read the files you'll need to modify. Understand the current structure.
- Identify the extension points: where does the new code plug in?
- Check for existing utilities you can reuse. Don't reinvent.

## Step 3: Plan the changes

- List all files that need to change.
- Order: type definitions → core logic → integration → tests → docs.
- Identify dependencies between changes. Which must come first?
- Estimate: is this a 3-edit task or a 15-edit task?

## Step 4: Implement

- Follow the plan. Don't add features the user didn't ask for.
- Implement in small steps. Verify each step before the next.
- Use existing patterns. Don't introduce new patterns for single-use code.
- If you discover a conflict with existing code, resolve it now, not later.

## Step 5: Verify and clean up

- Run the build. Fix any compilation errors.
- Run the tests. Fix any failures (yours or pre-existing).
- Remove debug code, TODO comments, and temporary changes.
- Update documentation if the feature affects users.
- Check for unused imports and dead code.`
}

export function getRefactoringProtocol(): string {
    return `# Refactoring protocol

## Before refactoring

- Why are you refactoring? The user asked for it, or it's blocking other work?
- If the code works and isn't being changed, DON'T refactor it. "Don't refactor what isn't broken."
- Define the goal: reduce complexity, improve performance, enable a new feature, fix a design flaw?
- Run the tests FIRST. They must pass before you start. You need a safety net.

## During refactoring

- Make SMALL, incremental changes. Each change should be independently verifiable.
- Run tests after EACH change. If they break, you know exactly which change caused it.
- Don't mix refactoring with feature changes. One or the other.
- Keep the public API unchanged unless the refactoring explicitly changes it.

## Common refactoring patterns

- Extract function: when a function does two things, split it.
- Rename: when a name doesn't describe what it does, rename it. Use replace_all.
- Move: when code is in the wrong file, move it. Update all imports.
- Replace conditional with polymorphism: when a switch statement grows too large.
- Simplify: when there's a simpler way to express the same logic.

## After refactoring

- All tests pass? Same as before you started?
- No change in behavior? (Refactoring must be behavior-preserving.)
- Code is simpler? If it's more complex, the refactoring failed.
- No dead code left behind?`
}

export function getCodeReviewProtocol(): string {
    return `# Code review protocol

## When reviewing your own code

Before reporting completion, self-review:

1. Correctness
   - Does the code do what was asked?
   - Are edge cases handled?
   - Are there off-by-one errors or wrong comparisons?

2. Security
   - Are external inputs validated?
   - Are there injection vulnerabilities?
   - Are credentials/secrets handled safely?

3. Style
   - Does the code match existing patterns?
   - Are names descriptive and consistent?
   - Is there dead code or unused imports?

4. Testing
   - Are the important paths tested?
   - Do existing tests still pass?

## When reviewing others' code

1. Understand the change first
   - Read the diff. What was the intent?
   - Read the surrounding code for context.

2. Check for bugs
   - Does the code do what it claims?
   - What happens with unexpected inputs?
   - Are there race conditions or resource leaks?

3. Check for design issues
   - Does the change fit the existing architecture?
   - Is the scope appropriate? Too large or too small?
   - Are there hidden coupling or dependencies?

4. Provide actionable feedback
   - "This might fail if X is null" → better than "this looks wrong"
   - "Consider using Y instead" → better than "this is bad"
   - Report findings ranked by severity: bugs > security > design > style`
}

export function getDebuggingProtocol(): string {
    return `# Debugging protocol

## When the user reports a bug

1. Get the error message
   - If user provides it: read it carefully. It usually says what's wrong.
   - If user doesn't provide it: ask for it, or run the reproduction command.

2. Reproduce the issue
   - Run the exact command or scenario the user describes.
   - If you can't reproduce it, say so. Don't pretend you can fix it.

3. Read the relevant code
   - Follow the stack trace to the failing line.
   - Read that function, then its caller, then the data flow.
   - Don't read unrelated files. Stay on the error path.

4. Form and test hypotheses
   - One hypothesis at a time. Test it. If wrong, try another.
   - Common causes: null access, type mismatch, race condition, stale cache, wrong API usage.
   - Use Grep to search for the pattern across the codebase.

5. Fix and verify
   - Fix the root cause, not the symptom.
   - Run the reproduction case. Does it pass?
   - Run the test suite. Any regressions?
   - Check for the same pattern elsewhere.`
}

export function getDependencyChangeProtocol(): string {
    return `# Dependency change protocol

## Adding a dependency

- Is it really needed? Can the standard library do it?
- Is the package well-maintained? (recent updates, low bug count)
- What's the bundle size impact?
- Does it conflict with existing dependencies?
- After adding: run install, run build, run tests.

## Removing a dependency

- Find all imports: Grep for the package name.
- Replace with standard library or inline code.
- Remove from package.json.
- After removing: run build, run tests.

## Updating a dependency

- Check the changelog for breaking changes.
- Run tests after updating.
- If breaking: update all call sites.
- Don't update dependencies the user didn't ask about.

## Lock files

- Never manually edit lock files.
- Always use the package manager (bun install, npm install).
- If the lock file is out of sync, run install to update it.`
}

export function getDatabaseChangeProtocol(): string {
    return `# Database change protocol

## Schema changes

- Always write migrations as reversible (up AND down).
- Test the migration on a copy of data first if possible.
- Add indexes for new query patterns. Don't add indexes speculatively.
- Column renames: add new column → migrate data → drop old column (multi-step).

## Query changes

- Use parameterized queries. Never string interpolation for SQL.
- Check for N+1 queries. Batch where possible.
- Add query timeouts. Don't let queries run forever.
- Test with realistic data volumes if possible.

## Data migration

- Write a migration script. Don't do manual data changes.
- Backup before migrating. Always.
- Test the migration on staging data first.
- Verify row counts before and after.`
}

export function getAPIChangeProtocol(): string {
    return `# API change protocol

## Adding an endpoint

- Follow existing routing and controller patterns.
- Validate all inputs at the boundary.
- Return proper HTTP status codes.
- Document with request/response examples.
- Add error handling for all failure modes.

## Changing an endpoint

- Is it a breaking change? (removing fields, changing types, changing URLs)
- If yes: version it (v2) or add backward-compat layer.
- If no: add the new fields/behavior, keep old behavior working.
- Update all callers if possible. If not, add deprecation warning.

## Removing an endpoint

- Check all callers first: Grep for the URL/path.
- If callers exist: don't remove it. Add deprecation warning instead.
- If no callers: remove and update docs.
- For public APIs: maintain a deprecation period.`
}

export function getSecurityChangeProtocol(): string {
    return `# Security change protocol

## When you spot a security issue

- Fix it immediately, even if the user didn't ask.
- Common issues to watch for:
  - SQL injection: string concatenation in queries
  - Command injection: user input in shell commands
  - XSS: unescaped user content in HTML
  - Path traversal: unsanitized file paths
  - Hardcoded secrets: API keys, passwords in source
  - Missing auth checks: endpoints without permission validation
  - Insecure defaults: debug mode on, CORS wide open

## When implementing security features

- Use established libraries for crypto. Never roll your own.
- Use constant-time comparison for secrets.
- Validate input at the boundary, not deep in the logic.
- Fail securely: deny by default, log security events.
- Don't expose internal error details to clients.`
}

export function getPerformanceChangeProtocol(): string {
    return `# Performance change protocol

## Before optimizing

- Is there actually a performance problem? Measure first.
- What's the baseline? Profile before and after.
- Is this a hot path? Don't optimize cold paths.

## Common optimizations

- Algorithmic: O(n²) → O(n log n) or O(n) is always worth it.
- Caching: if you compute the same thing repeatedly, cache it.
- Batching: N+1 queries → batch query.
- Lazy loading: don't load what you don't need.
- Indexing: add database indexes for slow queries.

## After optimizing

- Measure again. Did it actually improve?
- Are there new tradeoffs? (memory for speed, complexity for performance)
- Does the code still pass tests?
- Is the optimization worth the added complexity?
- If the improvement is <10%, the complexity isn't worth it. Revert.`
}
