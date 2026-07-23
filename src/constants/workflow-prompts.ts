export function getRefactoringWorkflowSection(): string {
    return `# Refactoring workflow

## Before starting
 - Run the existing test suite. All tests must pass before you begin.
 - If there are no tests, write characterization tests first. You need a safety net.
 - Identify the specific smell or problem. Don't refactor "just because."
 - Define the target state. What will the code look like when you're done?
 - Estimate the risk. Small steps are safer than big rewrites.

## During refactoring
 - Make one change at a time. Run tests after each change.
 - Use the rename refactoring first — it's safe and improves readability.
 - Extract method/function when a block of code does one identifiable thing.
 - Replace conditional with polymorphism when you see switch/type-checking chains.
 - Move method when a function uses more data from another class than its own.
 - Replace temp with query when a temporary variable is used only once.
 - Introduce parameter object when a function takes 3+ related parameters.

## After refactoring
 - Run the full test suite again. Fix any regressions immediately.
 - Verify no behavior changed. Tests should pass with the same assertions.
 - Check for dead code. Remove unused imports, variables, and functions.
 - Update documentation if public APIs changed.
 - Commit with a descriptive message: "refactor: extract UserValidator from UserService".

## Safety rules
 - Never refactor and fix bugs in the same commit.
 - Never refactor without tests. If tests don't exist, write them first.
 - Never change public API contracts without a deprecation period.
 - Never merge refactoring branches that have failing tests.

## Edge case checklist
 - Did you preserve behavior for empty/null/undefined inputs? Add a characterization test for each.
 - Did you check boundary conditions: empty collections, single-element, max-size, negative/zero values?
 - Did you verify error paths still throw the same exceptions with the same messages?
 - Did you check concurrent/async callers? Refactored shared state can introduce races.
 - Did you confirm public API signatures, return types, and thrown errors are unchanged?
 - Did you run the full test suite, not just the tests for the file you touched?`
}

export function getDebuggingWorkflowSection(): string {
    return `# Debugging workflow

## Reproduce first
 - Reproduce the bug reliably. If you can't reproduce it, you can't fix it.
 - Minimize the reproduction. Find the smallest input/steps that trigger it.
 - Check if it's a recent regression. Use git bisect to find the introducing commit.
 - Check if it's environment-specific. Reproduce in dev, staging, and production-like conditions.
 - Check if it's timing-dependent. Try with throttled network, slow CPU, or artificial delays.

## Investigate systematically
 - Form a hypothesis before changing code. "I think X is null because Y."
 - Test one hypothesis at a time. Don't change multiple things simultaneously.
 - Use binary search to narrow down: comment out half the code, see if the bug persists.
 - Add logging, not print statements. Use log levels. Include context in messages.
 - Use a debugger. Set breakpoints, inspect variables, step through execution.
 - Check the logs. Look for errors, warnings, and unusual patterns around the failure time.
 - Check the data. Verify assumptions about input data, database state, API responses.

## Common bug patterns
 - Off-by-one errors: check boundary conditions, loop invariants.
 - Null/undefined: check the type at each step. Where did the value come from?
 - Race conditions: add logging with timestamps. Use thread IDs in concurrent code.
 - State mutation: check if shared state is modified unexpectedly. Use immutable data.
 - Caching issues: clear the cache and retry. Check TTLs and invalidation logic.
 - Encoding issues: verify charset, check for BOM, validate UTF-8.

## Fix and verify
 - Write a failing test that reproduces the bug.
 - Fix the bug. Make the test pass.
 - Run the full test suite. Check for regressions.
 - Add regression tests for edge cases discovered during debugging.
 - Document the root cause in the commit message.

## Edge case checklist
 - Does the fix handle the original input AND the minimized reproduction input?
 - Does it handle boundary values: empty, null, off-by-one, max/min, negative?
 - Could the same bug class appear elsewhere? Grep for similar patterns.
 - Does the fix introduce new edge cases? What happens with the opposite extreme?
 - Is there a timing/concurrency version of the bug? Test under load if so.
 - Did you add a regression test that would fail without the fix?`
}

export function getCodeReviewWorkflowSection(): string {
    return `# Code review workflow

## Review checklist
 - Does the code do what it's supposed to? Check against the issue/requirement.
 - Are there tests? Do they test the right things? Are they testing behavior, not implementation?
 - Is the code readable? Can you understand it without the author explaining?
 - Are there error cases handled? What happens with bad input, network failure, empty state?
 - Are there security concerns? SQL injection, XSS, auth bypass, data exposure.
 - Is there performance impact? N+1 queries, unnecessary allocations, missing indexes.
 - Is the code consistent with the rest of the codebase? Naming, patterns, conventions.

## Review etiquette
 - Be specific. "This could be a problem because..." not "This is wrong."
 - Separate style preferences from correctness issues. Style = nit, correctness = blocking.
 - Ask questions instead of making demands. "What happens if X is null?" vs "Handle null."
 - Acknowledge good code. Positive feedback reinforces good patterns.
 - Don't block on things that can be fixed in a follow-up. Keep the PR moving.

## As an author
 - Keep PRs small. Under 400 lines is ideal. Under 200 is great.
 - Write a clear description: what, why, how. Link to the issue.
 - Self-review before requesting review. Add comments for non-obvious decisions.
 - Respond to every comment. Even if it's just "Done" or "Good point, will address in follow-up."
 - Don't take feedback personally. The code is not you.

## Edge case checklist
 - Bad input: empty, null, undefined, very long, unicode, special chars, negative, zero, max int.
 - Failure modes: network timeout, partial failure, connection reset, malformed response, 5xx.
 - Concurrency: race conditions, deadlocks, shared mutable state, idempotency.
 - Security: injection (SQL/XSS/command), auth bypass, data exposure, insecure deserialization, SSRF.
 - Resource leaks: unclosed handles, unbounded growth, missing cleanup on error path.
 - Performance: N+1 queries, O(n²) in hot path, unnecessary allocations, missing indexes.
 - Observability: are errors logged with context? Can this be debugged from logs alone?`
}

export function getFeatureDevelopmentSection(): string {
    return `# Feature development workflow

## Planning
 - Understand the requirement. Ask clarifying questions before writing code.
 - Identify the scope. What's in, what's out, what's deferred.
 - Design the interface first. API contracts, data models, user-facing behavior.
 - Identify risks and dependencies. What could go wrong? What needs to be ready first?
 - Break into small deliverables. Each should be testable and mergeable independently.

## Implementation order
 1. Set up the data model and types. Get the shape right first.
 2. Implement the core logic with unit tests. Don't worry about I/O yet.
 3. Add the I/O layer (API endpoints, CLI commands, UI components).
 4. Add error handling and edge cases.
 5. Add integration tests.
 6. Add logging and observability.
 7. Update documentation.

## Quality gates
 - All tests pass (unit, integration, e2e).
 - No lint warnings or type errors.
 - Code reviewed and approved.
 - Feature flag configured for gradual rollout.
 - Monitoring and alerts in place.
 - Documentation updated.

## Delivery
 - Use feature flags for risky changes. Roll out to internal users first.
 - Deploy to staging. Verify end-to-end.
 - Deploy to production. Monitor error rates and latency.
 - If something goes wrong, roll back. Investigate in a follow-up, not under pressure.

## Edge case checklist
 - Empty/null/undefined inputs and outputs for every public function.
 - Boundary values: 0, 1, max, negative, empty collection, single element.
 - Error and timeout paths: what does the user see when the dependency fails?
 - Concurrency: what if two calls happen at once? Is the operation idempotent?
 - Resource limits: disk full, memory pressure, rate limits, connection pool exhaustion.
 - Backward compatibility: does this break existing callers? Is there a migration path?
 - Rollback: can this be feature-flagged off? How fast can you revert?`
}

export function getIncidentResponseSection(): string {
    return `# Incident response workflow

## Triage (first 5 minutes)
 - Acknowledge the alert. Let the team know you're looking.
 - Assess severity: Is data lost? Are users affected? Is it getting worse?
 - Check recent deployments. Is this a regression from a recent change?
 - Check dependencies. Is a downstream service down? Is there a cloud provider incident?
 - Communicate: Post in the incident channel with what you know so far.

## Mitigate (next 30 minutes)
 - Stop the bleeding. Roll back, scale up, disable feature, block traffic.
 - Don't fix the root cause yet. Mitigate first, fix later.
 - Preserve evidence. Don't restart services without capturing logs and state.
 - Keep communicating. Update the incident channel every 10-15 minutes.
 - If you can't mitigate, escalate. Bring in more people. Page the on-call.

## Investigate
 - Check metrics: error rate, latency, throughput, saturation.
 - Check logs: look for error spikes, stack traces, unusual patterns.
 - Check traces: follow a request through the system. Where does it slow down or fail?
 - Check recent changes: deployments, config changes, traffic shifts.
 - Form and test hypotheses systematically.

## Resolve and follow up
 - Apply the fix. Verify it works in production.
 - Write a postmortem: timeline, root cause, impact, action items.
 - Schedule action items. Don't let them rot in a doc.
 - Share learnings with the team. Don't hide failures.

## Edge case checklist
 - Is the blast radius accurate? Check all regions, shards, customer segments, not just the noisy one.
 - Could the mitigation make it worse? Rollback may fail; scale-up may overload a dependency.
 - Is there data loss or corruption? Don't declare resolved until data integrity is verified.
 - Are dependent services affected? A downstream fix may cascade.
 - Is the alert itself reliable? Confirm with a second signal before acting on a single metric.

## Communication templates
 - First update (Triage, ~2 min): "🚨 SEV{1-3}: {symptom}. Impact: {users/regions}. Status: triaging, suspected cause {hypothesis}. On-call: @{name}."
 - Mitigation update (~10 min): "🔄 Mitigating: {action, e.g. rolling back to v{x}}. Current error rate {y}%, p99 {z}ms. Next update in 10 min."
 - Resolved (~30 min): "🟢 Resolved: {symptom} back to baseline. Error rate {y}%, p99 {z}ms. Root cause under investigation, postmortem within 24h."
 - Escalation (if mitigation fails): "⚠️ Escalating: mitigation {action} did not restore service. Paging {team/owner}. Plan B: {fallback action}."`
}

export function getMigrationGuideSection(): string {
    return `# Migration workflow

## Plan
 - Inventory what needs to change. List every file, config, and dependency affected.
 - Identify the blast radius. Who depends on this? What breaks if we change it?
 - Choose the migration strategy:
   - Big bang: switch everything at once (risky, fast)
   - Strangler fig: new system runs alongside old, gradually replaces (safer, slower)
   - Expand-contract: add new, migrate, then remove old (safest for APIs)
 - Create a rollback plan. Test it. Know how to undo every step.

## Execute
 - Create a feature branch. Don't migrate on main.
 - Make changes incrementally. Commit after each logical step.
 - Run tests after every step. Fix regressions immediately.
 - Use compatibility layers during transition. Don't force all consumers to change at once.
 - Document migration steps for other teams. Write a runbook.

## Validate
 - Run the full test suite. All green before merging.
 - Test in staging with production-like data volumes.
 - Canary deploy to production. Monitor for 24 hours before full rollout.
 - Check performance benchmarks. Migrations should not degrade performance.
 - Verify data integrity. Spot-check migrated data. Run checksums.

## Common migration patterns
 - API versioning: add /v2/, deprecate /v1/ with a sunset header, remove after grace period.
 - Database migration: add new column, backfill data, switch reads to new column, drop old column.
 - Library upgrade: update in a dedicated branch, fix breaking changes, run full test suite, merge.

## Edge case checklist
 - Empty dataset: does the migration work with zero records?
 - Partial failure: what happens if it crashes at 50%? Is it resumable/idempotent?
 - Data that violates new constraints: nulls, duplicates, oversized values, invalid formats.
 - Concurrent writes during migration: are old and new schemas both writable?
 - Rollback: can you reverse every step? Have you tested the rollback on real data?
 - Performance: does it lock tables? Will it time out on production data volumes?
 - Dual-read/dual-write consistency: can old and new code read each other's data during transition?`
}
