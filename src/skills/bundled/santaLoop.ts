import { registerBundledSkill } from '../bundledSkills.js'

const SANTA_LOOP_PROMPT = `# Santa Loop — Adversarial Dual-Review Convergence

Run two independent reviewers against the current task output. Both must PASS before code ships. If either FAILs, fix all flagged issues and re-run — up to 3 rounds.

## Purpose

Quality gate that prevents biased self-approval. Two reviewers with different perspectives must independently approve. No shared context between reviewers.

## Workflow

### Step 1: Identify What to Review

Determine scope from the user's input, or fall back to uncommitted changes:

\`\`\`bash
git diff --name-only HEAD
\`\`\`

Read all changed files to build full review context.

### Step 2: Build the Rubric

Construct a rubric with objective PASS/FAIL conditions. Include at minimum:

| Criterion | Pass Condition |
|-----------|---------------|
| Correctness | Logic is sound, handles edge cases |
| Security | No secrets, injection, XSS issues |
| Error handling | Errors handled explicitly, no silent swallowing |
| Completeness | All requirements addressed |
| Internal consistency | No contradictions between files |
| No regressions | Changes don't break existing behavior |

Add domain-specific criteria based on file types (type safety for TS, memory safety for Rust, etc.).

### Step 3: Dual Independent Review

Launch two reviewers IN PARALLEL using the Agent tool. Both must complete before proceeding.

**Reviewer A — Correctness Lens**: Focuses on logic bugs, edge cases, error handling, and functional correctness.

**Reviewer B — Security & Quality Lens**: Focuses on security vulnerabilities, code quality, maintainability, and architectural concerns.

Each reviewer evaluates every rubric criterion as PASS or FAIL, then returns:

\`\`\`json
{
  "verdict": "PASS" | "FAIL",
  "checks": [
    {"criterion": "...", "result": "PASS|FAIL", "detail": "..."}
  ],
  "critical_issues": ["..."],
  "suggestions": ["..."]
}
\`\`\`

### Step 4: Verdict Gate

| Reviewer A | Reviewer B | Action |
|-----------|-----------|--------|
| PASS | PASS | ✅ Ship it |
| PASS | FAIL | Fix Reviewer B's issues → re-run |
| FAIL | PASS | Fix Reviewer A's issues → re-run |
| FAIL | FAIL | Fix ALL issues → re-run |

### Step 5: Fix and Re-run (if needed)

1. Address ALL flagged issues from failing reviewer(s)
2. Commit the fixes
3. Re-run Step 3 with FRESH reviewers (not the same ones)
4. Maximum 3 rounds. If still failing after 3 rounds, report to user for manual review.

## Rules

- Reviewers MUST be independent — no shared context
- Reviewers MUST use different focus areas (correctness vs security/quality)
- Fix ALL issues, not just the easy ones
- Each re-run uses fresh reviewer instances
- After 3 failed rounds, escalate to user — don't keep looping
- Never lower standards to pass

## Anti-Patterns

- ❌ Using the same reviewer perspective twice
- ❌ Only fixing critical issues and ignoring major ones
- ❌ "Approving with concerns" — it's PASS or FAIL, no middle ground
- ❌ Running reviewers sequentially (they must be parallel to ensure independence)
- ❌ Skipping the rubric and reviewing ad-hoc

## Output Format

### Round [N/3]

**Scope**: [files reviewed]

**Reviewer A (Correctness)**:
- Verdict: [PASS/FAIL]
- Critical issues: [list or "none"]
- Checks summary: [X PASS / Y FAIL]

**Reviewer B (Security & Quality)**:
- Verdict: [PASS/FAIL]
- Critical issues: [list or "none"]
- Checks summary: [X PASS / Y FAIL]

**Gate Result**: [✅ Both PASS / ⚠️ Fixes needed]

**Fixes applied** (if any):
- [list of changes]

### Final Verdict
- Rounds used: [N]
- Status: [SHIPPED / ESCALATED]`

export function registerSantaLoopSkill(): void {
    registerBundledSkill({
        name: 'santa-loop',
        description: 'Adversarial dual-review convergence: two independent reviewers (correctness + security/quality) must both PASS before code ships. Max 3 rounds.',
        whenToUse:
            'When code must meet high quality standards before shipping. Use when the user says "santa loop", "dual review", "adversarial review", "quality gate", or "ship-ready check".',
        argumentHint: '<file path, glob, or description of what to review>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'uncommitted changes'
            return [{ type: 'text', text: `${SANTA_LOOP_PROMPT}\n\n## Review Target\n\n${topic}` }]
        },
    })
}
