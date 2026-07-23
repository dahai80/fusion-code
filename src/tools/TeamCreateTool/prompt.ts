export function getPrompt(): string {
    return `
# TeamCreate

## When to Use

Use this tool proactively whenever:
- The user explicitly asks to use a team, swarm, or group of agents
- The user mentions wanting agents to work together, coordinate, or collaborate
- A task is complex enough that it would benefit from parallel work by multiple agents

When in doubt about whether a task warrants a team, prefer spawning a team.

## Choosing Agent Types for Teammates

When spawning teammates via the Agent tool, choose the \`subagent_type\` based on what tools the agent needs for its task:

- **Read-only agents** (e.g., Explore, Plan) cannot edit or write files. Only assign them research, search, or planning tasks.
- **Full-capability agents** (e.g., general-purpose) have access to all tools including file editing, writing, and bash. Use these for tasks that require making changes.
- **Custom agents** defined in \`.claude/agents/\` may have their own tool restrictions.

Create a new team to coordinate multiple agents working on a project. Teams have a 1:1 correspondence with task lists (Team = TaskList).

\`\`\`
{
  "team_name": "my-project",
  "description": "Working on feature X"
}
\`\`\`

This creates:
- A team file at \`~/.claude/teams/{team-name}/config.json\`
- A corresponding task list directory at \`~/.claude/tasks/{team-name}/\`

## Team Workflow

1. **Create a team** with TeamCreate
2. **Create tasks** using the Task tools - they automatically use the team's task list
3. **Spawn teammates** using the Agent tool with \`team_name\` and \`name\` parameters
4. **Assign tasks** using TaskUpdate with \`owner\` to give tasks to idle teammates
5. **Teammates work on assigned tasks** and mark them completed via TaskUpdate
6. **Teammates go idle between turns** - after each turn, teammates automatically go idle
7. **Shutdown your team** - when complete, gracefully shut down teammates via SendMessage

## Task Ownership

Tasks are assigned using TaskUpdate with the \`owner\` parameter.

## Automatic Message Delivery

Messages from teammates are automatically delivered to you. You do NOT need to manually check your inbox.

## Teammate Idle State

Teammates go idle after every turn—this is normal and expected.
- **Idle teammates can receive messages.** Sending a message wakes them up.
- **Do not treat idle as an error.**

## Discovering Team Members

Teammates can read the team config file to discover other team members:
- **Team config location**: \`~/.claude/teams/{team-name}/config.json\`

Always refer to teammates by their NAME for messaging and task assignment.

## Task List Coordination

Teams share a task list at \`~/.claude/tasks/{team-name}/\`.

Teammates should:
1. Check TaskList periodically, especially after completing each task
2. Claim unassigned, unblocked tasks with TaskUpdate (prefer lowest ID first)
3. Create new tasks with TaskCreate when identifying additional work
4. Mark tasks completed with TaskUpdate, then check TaskList for next work

**IMPORTANT**: Always use SendMessage to communicate with teammates. Do NOT send structured JSON status messages.
`.trim()
}
