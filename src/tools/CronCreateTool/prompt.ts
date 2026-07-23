export const DESCRIPTION = `Schedule a prompt to be enqueued at a future time. Supports both recurring schedules and one-shot reminders.`

export function getPrompt(): string {
    return `Schedule a prompt to be enqueued at a future time. Supports both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week.

One-shot tasks (recurring: false):
- "remind me at 2:30pm today" -> cron: "30 14 <dom> <month> *", recurring: false
- "tomorrow morning, run tests" -> cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

Recurring jobs (recurring: true, the default):
- Every 5 minutes: "*/5 * * * *"
- Hourly: "7 * * * *"
- Weekdays at 9am: "3 9 * * 1-5"

Important:
- Avoid :00 and :30 minute marks — pick off-peak minutes (e.g., 57 8, 3 9)
- Recurring tasks auto-expire after 7 days
- Jobs only fire while the REPL is idle
- Set durable: true to persist across session restarts
- For one-shot, pin day-of-month and month for exact timing`
}
