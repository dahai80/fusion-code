export const DESCRIPTION = `Schedule when to resume work in a dynamic self-paced loop. The loop prompt fires again after the specified delay.`

export function getPrompt(): string {
    return `Schedule when to resume work in a /loop dynamic session — the user invoked /loop without an interval, asking you to self-pace iterations of a specific task.

Use this tool instead of CronCreate when the user wants a self-paced autonomous loop with no fixed cron schedule. The tool sets a one-shot wakeup; after the wakeup fires and you complete the next iteration, you decide the next delay based on what happened.

Pick delaySeconds based on what you're actually waiting for:
- Under 5 min (60-270s): actively polling external state (CI run, deploy)
- 5 min to 1 hour (300-3600s): no point checking sooner — idle or long wait
- Default idle tick: 1200-1800s (20-30 min)

Do NOT pick 300s exactly — it's the worst of both (cache miss without amortizing). Either drop to 270s or commit to 1200s+.

The runtime clamps delaySeconds to [60, 3600].

To end the loop, call this tool with stop: true — the loop ends immediately and no further wakeups fire.

Required: delaySeconds (unless stop is true) and prompt (unless stop is true).
The prompt should be the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. For autonomous /loop (no user prompt), pass the literal sentinel <<autonomous-loop-dynamic>> as prompt instead.`
}
