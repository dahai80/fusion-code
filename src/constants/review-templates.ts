export function getCodeReviewPrompt(changedFiles: string[]): string {
    const fileList = changedFiles.join(', ')
    return `Review the following changed files for correctness, security, and code quality: ${fileList}

Check each file for:
1. CORRECTNESS: Does the code do what it's supposed to? Are edge cases handled? Off-by-one errors? Missing returns?
2. SECURITY: Input validation, injection vulnerabilities, credential handling, permission checks.
3. READABILITY: Self-documenting code? Descriptive names? Clear control flow? No dead code?
4. DESIGN: Follows existing patterns? Appropriate scope? No hidden coupling? Backwards compatible?
5. TESTING: Tests for new behavior? Existing tests still pass? Tests are meaningful?

For each issue found, report:
- File path and line number
- Severity: critical / high / medium / low
- Category: correctness / security / readability / design / testing
- What's wrong and how to fix it

If no issues found, confirm the code is clean.`
}

export function getSecurityReviewPrompt(changedFiles: string[]): string {
    const fileList = changedFiles.join(', ')
    return `Perform a security review of the following files: ${fileList}

Check for:
1. INJECTION: Command injection, SQL injection, XSS, LDAP injection, template injection
2. AUTH/AUTHZ: Missing authentication, broken access control, privilege escalation
3. DATA EXPOSURE: Sensitive data in logs, hardcoded secrets, insecure defaults
4. INPUT VALIDATION: Missing validation at boundaries, unsafe deserialization, path traversal
5. CRYPTO: Weak algorithms, improper key management, missing TLS
6. DEPENDENCIES: Known vulnerable packages, outdated dependencies

For each finding:
- Severity: critical / high / medium / low
- OWASP category (if applicable)
- Attack scenario: how could this be exploited
- Remediation: how to fix it

If no security issues found, confirm the code passes security review.`
}

export function getPerformanceReviewPrompt(changedFiles: string[]): string {
    const fileList = changedFiles.join(', ')
    return `Review the following files for performance issues: ${fileList}

Check for:
1. ALGORITHMIC: O(n^2) or worse complexity, unnecessary nested loops, redundant traversals
2. MEMORY: Memory leaks, large allocations in hot paths, missing cleanup of subscriptions/timers
3. I/O: N+1 queries, unnecessary file reads, blocking operations in async code
4. CACHING: Missing memoization for expensive computations, redundant API calls
5. BUNDLING: Large imports, tree-shaking failures, unnecessary dependencies

For each finding:
- Severity: critical / high / medium / low
- Impact: estimated performance cost (latency, memory, CPU)
- Fix: concrete optimization suggestion

If no performance issues found, confirm the code is performant.`
}

export function getCompactReviewPrompt(changedFiles: string[]): string {
    const fileList = changedFiles.join(', ')
    return `Quick review of: ${fileList}

Check: correctness bugs, security holes, test coverage. Report only issues — skip if clean.`
}
