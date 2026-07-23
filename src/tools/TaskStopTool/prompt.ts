export const TASK_STOP_TOOL_NAME = 'TaskStop'

export const DESCRIPTION = `Stops a running background task by its ID.

Accepts:
- task_id: The ID of the background task to stop
- Also accepts agent team teammate names or agent IDs

When to use:
- Terminating a long-running task
- Stopping an agent that's taking too long
- Canceling a background shell process
- Stopping a workflow run

Important:
- This sends a stop signal — the task may not stop immediately
- Stopped tasks cannot be resumed
- Use TaskList to find running task IDs`
