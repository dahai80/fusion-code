import { registerBundledSkill } from '../bundledSkills.js'

const FINISHING_BRANCH_PROMPT = `# Finishing a Development Branch

You are now in branch-finishing mode. Implementation is done, tests pass — now decide how to integrate safely. Follow this structured process before merging.

## Phase 1: VERIFY — Confirm the work is complete

1. Run the full test suite → all must pass
2. Run the build → must succeed
3. Check for TODO/FIXME/HACK comments left behind
4. Verify all acceptance criteria from the original task are met
5. Check for accidental debug logging or console.log left in

**Gate**: All green? If NO → go fix, don't proceed.

## Phase 2: DETECT — Find potential conflicts

1. Check what branch you're on: \`git branch --show-current\`
2. Update the target branch: \`git fetch origin main\` (or develop)
3. Preview the merge: \`git log --oneline origin/main..HEAD\`
4. Check for conflicts: \`git merge-tree $(git merge-base origin/main HEAD) origin/main HEAD\`
5. Look for overlapping changes with recent main commits

**Gate**: Clean merge preview? If conflicts exist → proceed to Phase 3 options.

## Phase 3: OPTIONS — Choose integration strategy

Based on Phase 2 results:

| Situation | Strategy | Command |
|-----------|----------|---------|
| No conflicts, few commits | Merge | \`git merge origin/main\` |
| No conflicts, many commits | Rebase | \`git rebase origin/main\` |
| Conflicts, simple resolution | Rebase + resolve | \`git rebase origin/main\` then resolve |
| Conflicts, complex | Merge + resolve | \`git merge origin/main\` then resolve |
| Feature needs squashing | Squash merge | via PR or \`git merge --squash\` |

Rules:
- Prefer rebase for linear history when safe
- If unsure, merge is safer than rebase
- Never force-push to shared branches

## Phase 4: EXECUTE — Integrate the branch

1. Execute the chosen strategy from Phase 3
2. Resolve any conflicts carefully:
   - Read both sides of each conflict
   - Preserve intent from both branches
   - When in doubt, keep the more conservative change
3. Run tests again after integration
4. Run build again after integration

**Gate**: Tests and build pass after integration? If NO → fix before proceeding.

## Phase 5: CLEANUP — Remove artifacts

1. Delete the feature branch if merged: \`git branch -d <branch-name>\`
2. Delete remote branch if pushed: \`git push origin --delete <branch-name>\`
3. Remove any temporary files, debug scripts, or test fixtures
4. Update documentation if the feature affects user-facing behavior
5. Commit any remaining cleanup

## Anti-Patterns

- ❌ Merging without running tests first
- ❌ Ignoring merge conflicts and forcing through
- ❌ Leaving dead branches around
- ❌ Forgetting to update docs for user-facing changes
- ❌ Squashing without reviewing what gets combined
- ❌ Skipping the post-integration verification

## Output Format

### Phase 1: Verify
- Tests: [pass/fail]
- Build: [pass/fail]
- TODOs remaining: [count]
- Acceptance criteria met: [Y/N]

### Phase 2: Detect
- Current branch:
- Commits ahead of main:
- Conflicts: [none/list]
- Overlapping changes:

### Phase 3: Options
- Chosen strategy:
- Rationale:

### Phase 4: Execute
- Integration command:
- Conflicts resolved:
- Post-integration tests: [pass/fail]
- Post-integration build: [pass/fail]

### Phase 5: Cleanup
- Branch deleted:
- Temp files removed:
- Docs updated:`

export function registerFinishingBranchSkill(): void {
    registerBundledSkill({
        name: 'finishing-branch',
        description: 'Structured pre-merge workflow: verify → detect conflicts → choose strategy → execute integration → cleanup. Never merge blindly.',
        whenToUse:
            'When implementation is complete and you need to integrate work into the main branch. Also use when the user says "merge", "finish this branch", "integrate", "ready to merge", or "complete this feature".',
        argumentHint: '<branch-name or description>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const topic = args.trim() || 'the current branch'
            return [{ type: 'text', text: `${FINISHING_BRANCH_PROMPT}\n\n## Branch to Finish\n\n${topic}` }]
        },
    })
}
