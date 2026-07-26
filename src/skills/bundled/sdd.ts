import { registerBundledSkill } from '../bundledSkills.js'

const SDD_PROMPT = `# Subagent-Driven Development (SDD)

You are now in SDD mode — decompose the task into independent subtasks and assign each to a dedicated subagent via the Agent tool.

## Core Principle

Instead of doing everything yourself, delegate each unit of work to a focused subagent. You are the orchestrator; subagents are the workers.

## Workflow

1. **Decompose**: Break the user's task into independent, parallelizable subtasks.
   - Each subtask should be completable in isolation.
   - Subtasks should not depend on each other's output (if they do, sequence them).
2. **Spawn**: For each subtask, call the Agent tool with:
   - A clear, specific prompt describing what to implement
   - \`isolation: "worktree"\` if the subtask modifies files (prevents conflicts)
   - Appropriate model/effort for the task complexity
3. **Monitor**: Wait for all subagents to complete.
4. **Integrate**: Review results, resolve any conflicts, and integrate the work.
5. **Verify**: Run build/test to confirm everything works together.

## When to Use SDD

- Multiple independent features or files to modify
- Large refactors that touch different subsystems
- Parallel research tasks
- Any task where decomposition reduces cognitive load

## When NOT to Use SDD

- Single-file changes
- Tightly coupled modifications that need atomic commits
- Simple tasks a single agent can handle efficiently

## Best Practices

- Give each subagent a clear, self-contained prompt with all necessary context
- Include the file paths and existing patterns in the prompt
- Set per-subagent token budgets when the task is well-scoped
- Use worktree isolation when subagents modify files
- After all subagents complete, read their outputs and synthesize

## Action

Now decompose the user's task and begin spawning subagents.`

export function registerSddSkill(): void {
    registerBundledSkill({
        name: 'sdd',
        description:
            'Subagent-Driven Development — decompose tasks and delegate to parallel subagents',
        whenToUse:
            'When the user wants to decompose a complex task into parallel subtasks, or when multiple independent features need implementation simultaneously. Also useful when the user says "use SDD" or "subagent-driven" or "parallelize this".',
        argumentHint: '<task description>',
        userInvocable: true,
        async getPromptForCommand(args) {
            const task = args.trim() || 'the current task'
            return [{ type: 'text', text: `${SDD_PROMPT}\n\n## Task\n\n${task}` }]
        },
    })
}
