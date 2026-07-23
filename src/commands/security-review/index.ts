import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { parseSlashCommandToolsFromFrontmatter } from '../../utils/markdownConfigLoader.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const SECURITY_REVIEW_MARKDOWN = `---
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git show:*), Bash(git remote show:*), Read, Glob, Grep, LS, Task
description: Complete a security review of the pending changes on the current branch
---

You are a senior security engineer conducting a focused security review of the changes on this branch.

GIT STATUS:

\`\`\`
!\`git status\`
\`\`\`

FILES MODIFIED:

\`\`\`
!\`git diff --name-only origin/HEAD...\`
\`\`\`

COMMITS:

\`\`\`
!\`git log --no-decorate origin/HEAD...\`
\`\`\`

DIFF CONTENT:

\`\`\`
!\`git diff origin/HEAD...\`
\`\`\`

Review the complete diff above. This contains all code changes in the PR.

OBJECTIVE:
Perform a security-focused code review to identify HIGH-CONFIDENCE security vulnerabilities that could have real exploitation potential. This is not a general code review - focus ONLY on security implications newly added by this PR. Do not comment on existing security concerns.

CRITICAL INSTRUCTIONS:
1. MINIMIZE FALSE POSITIVES: Only flag issues where you're >80% confident of actual exploitability
2. AVOID NOISE: Skip theoretical issues, style concerns, or low-impact findings
3. FOCUS ON IMPACT: Prioritize vulnerabilities that could lead to unauthorized access, data breaches, or system compromise
4. EXCLUSIONS: Do NOT report the following issue types:
   - Denial of Service (DOS) vulnerabilities, even if they allow service disruption
   - Secrets or sensitive data stored on disk (these are handled by other processes)
   - Rate limiting or resource exhaustion issues

SECURITY CATEGORIES TO EXAMINE:

**Input Validation Vulnerabilities:**
- SQL injection via unsanitized user input
- Command injection in system calls or subprocesses
- XXE injection in XML parsing
- Template injection in templating engines
- NoSQL injection in database queries
- Path traversal in file operations

**Authentication & Authorization Issues:**
- Authentication bypass logic
- Privilege escalation paths
- Session management flaws
- JWT token vulnerabilities
- Authorization logic bypasses

**Crypto & Secrets Management:**
- Hardcoded API keys, passwords, or tokens
- Weak cryptographic algorithms or implementations
- Improper key storage or management
- Cryptographic randomness issues
- Certificate validation bypasses

**Injection & Code Execution:**
- Remote code execution via deserialization
- Pickle injection in Python
- YAML deserialization vulnerabilities
- Eval injection in dynamic code execution
- XSS vulnerabilities in web applications (reflected, stored, DOM-based)

**Data Exposure:**
- Sensitive data logging or storage
- PII handling violations
- API endpoint data leakage
- Debug information exposure

ANALYSIS METHODOLOGY:

Phase 1 - Repository Context Research (Use file search tools):
- Identify existing security frameworks and libraries in use
- Look for established secure coding patterns in the codebase
- Examine existing sanitization and validation patterns
- Understand the project's security model and threat model

Phase 2 - Comparative Analysis:
- Compare new code changes against existing security patterns
- Identify deviations from established secure practices
- Look for inconsistent security implementations
- Flag code that introduces new attack surfaces

Phase 3 - Vulnerability Assessment:
- Examine each modified file for security implications
- Trace data flow from user inputs to sensitive operations
- Look for privilege boundaries being crossed unsafely
- Identify injection points and unsafe deserialization

REQUIRED OUTPUT FORMAT:

You MUST output your findings in markdown. The markdown output should contain the file, line number, severity, category, description, exploit scenario, and fix recommendation.

SEVERITY GUIDELINES:
- **HIGH**: Directly exploitable vulnerabilities leading to RCE, data breach, or authentication bypass
- **MEDIUM**: Vulnerabilities requiring specific conditions but with significant impact
- **LOW**: Defense-in-depth issues or lower-impact vulnerabilities

CONFIDENCE SCORING:
- 0.9-1.0: Certain exploit path identified, tested if possible
- 0.8-0.9: Clear vulnerability pattern with known exploitation methods
- Below 0.8: Don't report (too speculative)

FINAL REMINDER:
Focus on HIGH and MEDIUM findings only. Better to miss some theoretical issues than flood the report with false positives.

FALSE POSITIVE FILTERING:

> HARD EXCLUSIONS - Automatically exclude findings matching these patterns:
> 1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks.
> 2. Secrets or credentials stored on disk if they are otherwise secured.
> 3. Rate limiting concerns or service overload scenarios.
> 4. Memory consumption or CPU exhaustion issues.
> 5. Lack of input validation on non-security-critical fields without proven security impact.
> 6. A lack of hardening measures. Code is not expected to implement all security best practices.
> 7. Race conditions or timing attacks that are theoretical rather than practical issues.
> 8. Vulnerabilities related to outdated third-party libraries.
> 9. Memory safety issues in memory-safe languages.
> 10. Files that are only unit tests or only used as part of running tests.
> 11. Log spoofing concerns. Outputting un-sanitized user input to logs is not a vulnerability.
> 12. SSRF vulnerabilities that only control the path.
> 13. Including user-controlled content in AI system prompts is not a vulnerability.
> 14. Regex injection or regex DOS concerns.
> 15. Insecure documentation files.
> 16. A lack of audit logs is not a vulnerability.

START ANALYSIS:

Begin your analysis now. Do this in 3 steps:

1. Use a sub-task to identify vulnerabilities. Use the repository exploration tools to understand the codebase context, then analyze the PR changes for security implications.
2. Then for each vulnerability identified by the above sub-task, create a new sub-task to filter out false-positives. Launch these sub-tasks as parallel sub-tasks.
3. Filter out any vulnerabilities where the sub-task reported a confidence less than 8.

Your final reply must contain the markdown report and nothing else.`

export default createMovedToPluginCommand({
    name: 'security-review',
    description:
        'Complete a security review of the pending changes on the current branch',
    progressMessage: 'analyzing code changes for security risks',
    pluginName: 'security-review',
    pluginCommand: 'security-review',
    async getPromptWhileMarketplaceIsPrivate(_args, context) {
        const parsed = parseFrontmatter(SECURITY_REVIEW_MARKDOWN)
        const allowedTools = parseSlashCommandToolsFromFrontmatter(
            parsed.frontmatter['allowed-tools'],
        )
        const processedContent = await executeShellCommandsInPrompt(
            parsed.content,
            {
                ...context,
                getAppState() {
                    const appState = context.getAppState()
                    return {
                        ...appState,
                        toolPermissionContext: {
                            ...appState.toolPermissionContext,
                            alwaysAllowRules: {
                                ...appState.toolPermissionContext.alwaysAllowRules,
                                command: allowedTools,
                            },
                        },
                    }
                },
            },
            'security-review',
        )

        return [
            {
                type: 'text',
                text: processedContent,
            },
        ]
    },
})
