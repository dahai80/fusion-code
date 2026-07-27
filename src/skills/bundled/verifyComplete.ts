import { registerBundledSkill } from '../bundledSkills.js'

const VERIFY_PROMPT = `# Verification Before Completion

You are now in verification mode. Before declaring any task done, you MUST verify the work thoroughly.

## Verification Checklist

For EVERY task, check ALL that apply:

### 1. Build Verification
- [ ] Does the project build successfully? (run the build command)
- [ ] Are there any TypeScript/compile errors?
- [ ] Are there any new warnings introduced?

### 2. Functional Verification
- [ ] Does the changed code do what was requested?
- [ ] Are edge cases handled?
- [ ] Does error handling work correctly?

### 3. Integration Verification
- [ ] Do existing features still work?
- [ ] Are there any import/export issues?
- [ ] Are there any circular dependencies?

### 4. Code Quality
- [ ] Does the new code match existing patterns and style?
- [ ] Are there any hardcoded values that should be configurable?
- [ ] Is logging sufficient for debugging?

## Process

1. Run the build command first. If it fails, STOP and fix before continuing.
2. Read the changed files and verify correctness.
3. Check for regressions by reviewing affected callers/importers.
4. If any check fails, fix the issue and re-verify.
5. Only declare "done" when ALL checks pass.

## Rules

- Never claim a task is complete without running the build
- If the build fails, the task is NOT done — fix it
- If verification reveals issues, fix them immediately — don't just report them
- Re-verify after every fix (build again)

## Action

Now verify the current task using this checklist.`

export function registerVerifyCompleteSkill(): void {
    registerBundledSkill({
        name: 'verify-complete',
        description: 'Enforce verification checklist before declaring any task done',
        whenToUse:
            'When the user says "verify", "check my work", "make sure this is correct", or when a task is about to be declared complete. Also useful as a final step before committing.',
        argumentHint: '[what to verify]',
        userInvocable: true,
        async getPromptForCommand(args) {
            const focus = args.trim() || 'the most recent changes'
            return [{ type: 'text', text: `${VERIFY_PROMPT}\n\n## Focus\n\n${focus}` }]
        },
    })
}
