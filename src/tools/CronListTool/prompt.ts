export const DESCRIPTION = `List all cron jobs scheduled via CronCreate.`

export function getPrompt(): string {
    return `List all cron jobs scheduled via CronCreate, both durable and session-only.

Use this to:
- Check what jobs are currently scheduled
- Find job IDs for deletion
- Verify a job was created successfully
- Audit scheduled tasks

Returns:
- Job ID (for use with CronDelete)
- Cron schedule expression
- Whether the job is durable or session-only
- The prompt that will fire
- Recurring status`
}
