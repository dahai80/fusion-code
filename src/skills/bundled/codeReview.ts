import { registerBundledSkill } from '../bundledSkills.js'

const CODE_REVIEW_PROMPT = `# Code Review

You are now in code review mode. Perform a thorough, structured review across security, performance, and maintainability dimensions.

## Review Dimensions

### 1. Security (Critical)
- Injection vulnerabilities (SQL, command, XSS, template)
- Authentication issues (hardcoded credentials, weak auth)
- Authorization flaws (missing access controls, IDOR)
- Data exposure (sensitive data in logs, error messages)
- Cryptography (weak algorithms, improper key management)
- Dependency vulnerabilities

### 2. Correctness
- Logic errors and off-by-one mistakes
- Missing error handling (silent swallowing, uncaught exceptions)
- Race conditions and concurrency issues
- Resource leaks (file handles, connections, memory)
- Null/undefined handling
- Edge cases (empty inputs, boundary values, large inputs)

### 3. Performance
- N+1 queries or redundant API calls
- Unnecessary computations in hot paths
- Memory-inefficient data structures
- Missing caching opportunities
- Large bundle size contributions (frontend)

### 4. Maintainability
- Naming clarity (variables, functions, types)
- Function/method length (should be < 30 lines ideally)
- Code duplication (DRY violations)
- Over-abstraction (YAGNI violations)
- Missing or misleading comments
- Type safety issues

### 5. Testing
- Are there tests for the new behavior?
- Do tests cover edge cases?
- Are tests testing behavior (not implementation)?
- Are mocks appropriate (not over-mocked)?

## Review Process

1. **Understand intent**: Read the PR/commit description. What problem does this solve?
2. **Read diff**: Focus on changed files. Understand what was added/removed/modified.
3. **Trace flow**: Follow the code path from entry point to output.
4. **Check each dimension**: Go through the checklist above systematically.
5. **Prioritize findings**: Critical > Major > Minor > Suggestion.

## Finding Severity Levels

| Level | Meaning | Action Required |
|-------|---------|----------------|
| 🔴 Critical | Bug, security vulnerability, data loss risk | Must fix before merge |
| 🟠 Major | Significant issue that could cause problems | Should fix before merge |
| 🟡 Minor | Code quality issue, non-idiomatic pattern | Nice to fix, not blocking |
| 🔵 Suggestion | Alternative approach, style preference | Optional |

## Rules

- Be specific: cite file, line, and explain WHY something is wrong
- Provide the fix, not just the complaint
- Acknowledge good patterns when you see them
- Don't nitpick style if a linter/formatter handles it
- Separate objective issues from subjective preferences
- Focus on the diff, not the entire codebase

## Anti-Patterns

- ❌ Vague feedback ("this could be better")
- ❌ Style nitpicks that linters handle
- ❌ Suggesting complete rewrites without justification
- ❌ Approving without reading the code
- ❌ Only looking for bugs, ignoring architecture

## Output Format

### Summary
[Brief overall assessment]

### Findings

| # | Severity | File:Line | Issue | Suggested Fix |
|---|----------|-----------|-------|---------------|

### Positive Patterns
[What was done well]

### Verdict
- 🔴 Request changes (critical/major findings)
- 🟡 Approve with suggestions (minor findings only)
- 🟢 Approve (clean or trivial suggestions)`

export function registerCodeReviewSkill(): void {
    registerBundledSkill({
        name: 'code-review',
        description: 'Structured code review across security, correctness, performance, maintainability, and testing dimensions with severity-rated findings.',
        whenToUse:
            'When reviewing code before merging, auditing a codebase, or when the user says "review", "code review", "check this code", "audit", or "look for issues".',
        argumentHint: '<file path, PR description, or area to review>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'the current changes'
            return [{ type: 'text', text: `${CODE_REVIEW_PROMPT}\n\n## Code to Review\n\n${topic}` }]
        },
    })
}
