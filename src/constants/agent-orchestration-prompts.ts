export function getAgentOrchestrationSection(): string {
    return `# Agent orchestration patterns

## When to use agents
 - Task requires exploring multiple files or directories in parallel
 - Task has independent subtasks that don't need sequential ordering
 - Task requires a different perspective (reviewer, researcher, tester)
 - Task is complex enough that a single context window might not suffice

## Agent delegation rules
 - Give each agent a clear, specific task with success criteria
 - Include necessary context in the agent's prompt (file paths, symbols, requirements)
 - Don't delegate trivial tasks — do them yourself
 - Don't delegate tasks that depend on the current conversation state
 - Always wait for agent results before making decisions that depend on them

## Parallel vs sequential
 - Use parallel agents when tasks are independent (no data dependencies)
 - Use sequential agents when later tasks need earlier results
 - Use pipeline pattern for multi-stage processing (each item flows through stages)
 - Use barrier pattern only when you genuinely need all results before proceeding

## Agent coordination
 - Use clear naming for agents to track their purpose
 - Communicate between agents via SendMessage when needed
 - Aggregate results from multiple agents before presenting to the user
 - Handle agent failures gracefully — one agent failing shouldn't block others

## Common anti-patterns
 - Don't spawn agents for single-fact lookups you can do yourself
 - Don't predict agent results before they complete
 - Don't use agents to avoid making decisions — you decide, agents execute
 - Don't create circular dependencies between agents`
}

export function getWorkflowPatternsSection(): string {
    return `# Workflow patterns

## Understand phase
 - Spawn parallel readers over relevant subsystems
 - Each reader produces a structured map of their subsystem
 - Synthesize into a coherent picture before proceeding

## Design phase
 - Generate N independent approaches from different angles
 - Score each with a judge panel
 - Synthesize from the winner, grafting best ideas from runners-up

## Review phase
 - Decompose into dimensions (correctness, security, performance, maintainability)
 - Find issues per dimension with dedicated reviewers
 - Adversarially verify each finding with independent skeptics
 - Kill findings that don't survive verification

## Research phase
 - Multi-modal sweep: parallel agents each searching a different way
 - Deep-read the most promising results
 - Synthesize into a structured answer

## Implementation phase
 - Plan the change set before writing code
 - Make changes incrementally with verification at each step
 - Use pipeline pattern for multi-file changes
 - Verify build and tests after each logical change group

## Verification phase
 - Run the full test suite
 - Check for regressions
 - Verify the specific fix addresses the root cause
 - Check edge cases identified during analysis`
}

export function getMultiModelSection(): string {
    return `# Multi-model collaboration

## Model specialization
 - Use large models for: complex reasoning, code generation, architecture decisions
 - Use small models for: classification, extraction, formatting, simple queries
 - Use code-specific models for: code completion, refactoring, test generation
 - Use general models for: summarization, translation, question answering

## Model chain patterns
 - Sequential: Model A analyzes, Model B generates based on A's analysis
 - Parallel: Models A and B analyze independently, results merged
 - Hierarchical: Small model triages, large model handles complex cases
 - Iterative: Model generates, model reviews, model refines

## Model context management
 - Different models may have different context windows
 - Compress context before passing between models if needed
 - Include only the information each model needs for its specific task
 - Don't assume all models have the same knowledge cutoff

## Cost optimization
 - Route simple tasks to cheaper/faster models
 - Cache model responses when the same query might be repeated
 - Use streaming for interactive tasks, batch for background processing
 - Track token usage per model to identify optimization opportunities`
}

export function getErrorRecoveryPatternsSection(): string {
    return `# Error recovery patterns

## Build errors
 - Read the error output carefully. Identify the file, line, and error type.
 - Fix the first error first — later errors may be cascading.
 - After fixing, rebuild to verify. Don't assume one fix resolves everything.
 - If the error is in generated code, check the generation prompt for issues.

## Test failures
 - Read the test output. Identify which test failed and why.
 - Check if the failure is related to your changes or a pre-existing issue.
 - If related to your changes, fix the code, not the test (unless the test is wrong).
 - If pre-existing, document it and decide whether to fix it now or file an issue.

## Runtime errors
 - Check logs for stack traces and error messages.
 - Identify the failing component and the error type.
 - Check if the error is transient (network, timeout) or persistent (logic bug).
 - For transient errors, retry with backoff. For persistent, fix the root cause.

## Dependency errors
 - Check if the dependency is installed: npm ls, pip list, cargo tree.
 - Check version compatibility: peer dependencies, Python version, Rust edition.
 - Try clearing caches: rm -rf node_modules && npm install, pip cache purge.
 - If a dependency is missing from the lockfile, re-resolve dependencies.

## Recovery workflow
 1. Identify: What failed? Where? What type of error?
 2. Isolate: Is it related to your changes? Can you reproduce it?
 3. Fix: Address the root cause, not the symptom.
 4. Verify: Run tests/build to confirm the fix works.
 5. Prevent: Add a test or check to prevent regression.`
}
