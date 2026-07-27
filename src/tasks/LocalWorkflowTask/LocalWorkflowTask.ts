// log: created for TS2307 fix

import type { SetAppState, Task, TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
    type: 'local_workflow'
    agents: string[]
    currentAgentIndex: number
    abortController?: AbortController
    summary?: string // log: fix TS2339
}

export function killWorkflowTask(
    taskId: string,
    setAppState: SetAppState,
): void {
    console.log('[LocalWorkflowTask] killWorkflowTask called', taskId)
}

export function skipWorkflowAgent(
    taskId: string,
    agentId: string,
    setAppState: SetAppState,
): void {
    console.log('[LocalWorkflowTask] skipWorkflowAgent called', taskId, agentId)
}

export function retryWorkflowAgent(
    taskId: string,
    agentId: string,
    setAppState: SetAppState,
): void {
    console.log('[LocalWorkflowTask] retryWorkflowAgent called', taskId, agentId)
}

export const LocalWorkflowTask: Task = {
    name: 'LocalWorkflowTask',
    type: 'local_workflow',

    async kill(taskId, setAppState) {
        killWorkflowTask(taskId, setAppState)
    },
}
