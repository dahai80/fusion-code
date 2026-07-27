import { logForDebugging } from '../../utils/debug.js'
import { getNotificationManager } from './notificationManager.js'

export type RecoveryReport = {
    recovered: number
    lost: number
    alreadyTerminal: number
    total: number
}

type TaskState = {
    taskId: string
    taskType: string
    status: string
    description: string
    startedAt?: number
    lastUpdatedAt?: number
}

export function recoverTasks(tasks: TaskState[]): RecoveryReport {
    const report: RecoveryReport = {
        recovered: 0,
        lost: 0,
        alreadyTerminal: 0,
        total: tasks.length,
    }

    const terminalStatuses = new Set(['completed', 'failed', 'killed', 'lost', 'stopped', 'exited'])

    for (const task of tasks) {
        if (terminalStatuses.has(task.status)) {
            report.alreadyTerminal++
            continue
        }

        if (task.status === 'running') {
            report.lost++
            logForDebugging(`task-crash-recovery-lost taskId=${task.taskId} taskType=${task.taskType}`) // log: inline data into message string
            getNotificationManager().publish({
                taskId: task.taskId,
                taskType: task.taskType,
                event: 'lost',
                summary: `Task "${task.description}" was running in a previous session and is now lost`,
            })
        } else if (task.status === 'pending') {
            report.recovered++
            logForDebugging(`task-crash-recovery-recovered taskId=${task.taskId} taskType=${task.taskType}`) // log: inline data into message string
        }
    }

    logForDebugging(`task-crash-recovery-complete ${JSON.stringify(report)}`) // log: inline data into message string
    return report
}
