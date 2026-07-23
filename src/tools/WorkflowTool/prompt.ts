export const DESCRIPTION = `Execute a workflow script that orchestrates multiple subagents.`

export function getPrompt(): string {
    return `Execute a workflow script that orchestrates multiple subagents deterministically.

Workflows run in the background — returns immediately with a task ID.
Use /workflows to watch live progress.

When to use (ONLY when user has explicitly opted into multi-agent orchestration):
- User included "ultracode" keyword
- User asked to "run a workflow" or "use multi-agent orchestration"
- User invoked a skill that requires Workflow

Script structure:
- Must begin with: export const meta = { name, description, phases }
- Use agent() to spawn subagents
- Use pipeline() for multi-stage work (default, no barrier)
- Use parallel() for synchronized stages (barrier)
- Use phase() to group agents under a progress title

Key patterns:
- Adversarial verify: N independent skeptics per finding, kill if majority refute
- Judge panel: N independent attempts, score, synthesize from winner
- Loop-until-dry: Keep spawning finders until K consecutive rounds return nothing new
- Multi-modal sweep: Parallel agents each searching a different way

Limits:
- Concurrent agents capped at min(16, cpu cores - 2)
- Total agent count capped at 1000 per workflow
- Max 4096 items per parallel/pipeline call`
}
