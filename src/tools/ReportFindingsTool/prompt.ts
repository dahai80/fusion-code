export const DESCRIPTION = `Report code-review findings as a typed list.`

export function getPrompt(): string {
    return `Report code-review findings as a typed list for the host UI to render.

Use only when active code-review instructions tell you to report findings
with this tool. Otherwise follow whatever output format those instructions specify.

When reporting:
- Call once with verified findings ranked most-severe first
- Empty array if nothing survived verification
- When re-reporting after fixes, set outcome on each finding

Finding fields:
- file: Repo-relative path
- line: 1-indexed line number
- summary: One-sentence statement of the defect
- short_summary: Compressed label (≤60 chars)
- failure_scenario: Concrete inputs/state -> wrong output/crash
- category: Short kebab-case slug (correctness, security, perf, etc.)
- verdict: Set during verify pass (CONFIRMED or PLAUSIBLE)
- outcome: Set ONLY when re-reporting after fixes (fixed, skipped, no_change_needed)`
}
