const CRON_CREATE_TOOL_NAME = 'CronCreate'
const CRON_DELETE_TOOL_NAME = 'CronDelete'
const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'
const DEFAULT_MAX_AGE_DAYS = 7
const isKairosCronEnabled = (): boolean => true
import { registerBundledSkill } from '../bundledSkills.js'

const DEFAULT_INTERVAL = '10m'

const USAGE_MESSAGE = `Usage: /loop [interval] <prompt>
       /loop dynamic [prompt]
       /loop prd <prd-file>

Run a prompt or slash command on a recurring interval.

Modes:
  (default)   Recurring cron: /loop [interval] <prompt>
  dynamic     Self-paced loop: /loop dynamic [prompt]
  prd         PRD-driven task loop: /loop prd <prd-file>

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to ${DEFAULT_INTERVAL}.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop dynamic monitor the CI pipeline
  /loop prd requirements.prd.json`

function buildCronPrompt(args: string): string {
    return `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it with ${CRON_CREATE_TOOL_NAME}.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **Default**: otherwise, interval is \`${DEFAULT_INTERVAL}\` and the entire input is the prompt.

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop — do not call ${CRON_CREATE_TOOL_NAME}.

Examples:
- \`5m /babysit-prs\` → interval \`5m\`, prompt \`/babysit-prs\` (rule 1)
- \`check the deploy every 20m\` → interval \`20m\`, prompt \`check the deploy\` (rule 2)
- \`run tests every 5 minutes\` → interval \`5m\`, prompt \`run tests\` (rule 2)
- \`check the deploy\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check the deploy\` (rule 3)
- \`check every PR\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check every PR\` (rule 3 — "every" not followed by time)
- \`5m\` → empty prompt → show usage

## Interval → cron

Supported suffixes: \`s\` (seconds, rounded up to nearest minute, min 1), \`m\` (minutes), \`h\` (hours), \`d\` (days). Convert:

| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| \`Nm\` where N ≤ 59   | \`*/N * * * *\`     | every N minutes                          |
| \`Nm\` where N ≥ 60   | \`0 */H * * *\`     | round to hours (H = N/60, must divide 24)|
| \`Nh\` where N ≤ 23   | \`0 */N * * *\`     | every N hours                            |
| \`Nd\`                | \`0 0 */N * *\`     | every N days at midnight local           |
| \`Ns\`                | treat as \`ceil(N/60)m\` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. \`7m\` → \`*/7 * * * *\` gives uneven gaps at :56→:00; \`90m\` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.

## Action

1. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from the table above
   - \`prompt\`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - \`recurring\`: \`true\`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

${args}`
}

function buildDynamicPrompt(args: string): string {
    const taskDesc = args.trim() || 'continue working on the current task'
    return `# /loop dynamic — self-paced autonomous loop

You are now in a dynamic self-paced loop. Use ${SCHEDULE_WAKEUP_TOOL_NAME} to schedule your own wake-ups and control your pacing.

## How it works

1. Do a unit of work on the current task.
2. After completing the work, call ${SCHEDULE_WAKEUP_TOOL_NAME} with:
   - \`delaySeconds\`: how long to wait before the next iteration
   - \`prompt\`: pass back the literal sentinel \`<<autonomous-loop-dynamic>>\` for autonomous loops, or a specific prompt for user-directed loops
   - \`reason\`: one short sentence explaining what you're waiting for and why
3. When the task is fully done, call ${SCHEDULE_WAKEUP_TOOL_NAME} with \`stop: true\` to end the loop.

## Choosing delaySeconds

- **60-270s**: actively polling external state (CI runs, deploys, remote queues). Keeps the cache warm.
- **300-3600s**: waiting on something that takes minutes. Accept the cache miss.
- **1200-1800s (20-30 min)**: idle ticks with no specific signal. The loop checks back; the user can interrupt sooner.
- **Never use 300s exactly** — worst of both: cache miss without amortizing.

## Rules

- Each iteration should produce visible progress or a clear status update.
- If you hit an unrecoverable error, stop the loop with \`stop: true\`.
- The loop auto-expires after 7 days of recurring schedules.
- Pass the SAME sentinel prompt each turn so the next firing re-enters the loop.

## Task

${taskDesc}`
}

function buildPrdPrompt(args: string): string {
    const prdFile = args.trim()
    if (!prdFile) {
        return `# /loop prd — PRD-driven task loop

Usage: /loop prd <prd-file>

Provide a path to a PRD file (JSON) with the structure:
{
  "projectName": "string",
  "userStories": [
    { "id": "US-001", "title": "string", "description": "string", "acceptance": ["string"] }
  ]
}

Each user story becomes a self-contained task. The orchestrator will:
1. Read the PRD file
2. For each user story, spawn a subagent via the Agent tool
3. Verify the result meets acceptance criteria
4. Move to the next story on success, retry on failure (max 2 retries)
5. Report final status when all stories are done

No PRD file specified. Use: /loop prd <path-to-prd.json>`
    }
    return `# /loop prd — PRD-driven task loop

You are now in a PRD-driven loop. Execute the project defined in the PRD file.

## Workflow

1. Read the PRD file at: \`${prdFile}\`
2. Parse the user stories from the JSON.
3. For each user story:
   a. Create a task via TaskCreate with the story title and description.
   b. Spawn a subagent via the Agent tool to implement the story. Give it:
      - The full story description and acceptance criteria
      - Instructions to implement the feature end-to-end
      - Access to all necessary tools
   c. After the agent completes, verify the acceptance criteria:
      - Read the changed files
      - Run any tests or build commands
      - If criteria are not met, retry once with corrective feedback
   d. Update the task status (completed or note issues).
4. After all stories are processed, produce a summary:
   - Which stories passed/failed
   - What files were changed
   - Any remaining issues
5. Call ${SCHEDULE_WAKEUP_TOOL_NAME} with \`stop: true\` to end the loop.

## Error handling

- If a story fails after 2 attempts, skip it and note the failure in the summary.
- If the PRD file is unreadable or malformed, report the error and stop.
- If a subagent crashes, retry once. If it crashes again, skip that story.

## PRD file

${prdFile}`
}

export function registerLoopSkill(): void {
    registerBundledSkill({
        name: 'loop',
        description:
            'Run a prompt on a recurring interval, dynamic self-paced loop, or PRD-driven task loop',
        whenToUse:
            'When the user wants to set up a recurring task (e.g. "check the deploy every 5 minutes"), a self-paced autonomous loop (/loop dynamic), or a PRD-driven task loop (/loop prd). Do NOT invoke for one-off tasks.',
        argumentHint: '[interval|dynamic|prd] <prompt|file>',
        userInvocable: true,
        isEnabled: isKairosCronEnabled,
        async getPromptForCommand(args) {
            const trimmed = args.trim()
            if (!trimmed) {
                return [{ type: 'text', text: USAGE_MESSAGE }]
            }
            if (trimmed.startsWith('dynamic')) {
                const rest = trimmed.slice('dynamic'.length).trim()
                return [{ type: 'text', text: buildDynamicPrompt(rest) }]
            }
            if (trimmed.startsWith('prd')) {
                const rest = trimmed.slice('prd'.length).trim()
                return [{ type: 'text', text: buildPrdPrompt(rest) }]
            }
            return [{ type: 'text', text: buildCronPrompt(trimmed) }]
        },
    })
}
