export const DESCRIPTION = `Cancel a cron job previously scheduled with CronCreate.`

export function getPrompt(): string {
    return `Cancel a cron job previously scheduled with CronCreate.

Removes the job from .claude/scheduled_tasks.json (durable) or the in-memory
session store (session-only). The job will no longer fire.

When to use:
- Canceling a recurring task that's no longer needed
- Dismissing a one-shot reminder
- Cleaning up scheduled jobs

Important:
- You need the job ID returned by CronCreate
- This is idempotent — deleting a non-existent job is safe
- Session-only jobs are automatically removed when the session ends`
}
