import { logForDebugging } from '../../utils/debug.js'
import { getNotificationManager } from './notificationManager.js'

export type TaskHealthStatus = 'healthy' | 'stale' | 'lost'

export type TaskHealthCheck = {
    taskId: string
    health: TaskHealthStatus
    reason: string
    lastActivityAt: number | null
    staleThresholdMs: number
}

const DEFAULT_STALE_THRESHOLD_MS = 30_000
const LOST_THRESHOLD_MS = 120_000

function getStaleThreshold(): number {
    const env = process.env.FUSION_TASK_STALE_MS
    if (env) {
        const parsed = parseInt(env, 10)
        if (!isNaN(parsed) && parsed > 0) return parsed
    }
    return DEFAULT_STALE_THRESHOLD_MS
}

type TaskInfo = {
    taskId: string
    taskType: string
    status: string
    description: string
    startedAt?: number
    lastUpdatedAt?: number
    pid?: number | null
}

export function checkTaskHealth(tasks: TaskInfo[]): TaskHealthCheck[] {
    const staleMs = getStaleThreshold()
    const now = Date.now()
    const results: TaskHealthCheck[] = []

    for (const task of tasks) {
        if (task.status !== 'running') continue

        const lastActivity = task.lastUpdatedAt ?? task.startedAt ?? null
        const elapsed = lastActivity ? now - lastActivity : null

        if (elapsed === null) {
            results.push({
                taskId: task.taskId,
                health: 'healthy',
                reason: 'no timing info',
                lastActivityAt: lastActivity,
                staleThresholdMs: staleMs,
            })
            continue
        }

        if (elapsed > LOST_THRESHOLD_MS) {
            results.push({
                taskId: task.taskId,
                health: 'lost',
                reason: `no activity for ${Math.round(elapsed / 1000)}s (>${Math.round(LOST_THRESHOLD_MS / 1000)}s)`,
                lastActivityAt: lastActivity,
                staleThresholdMs: staleMs,
            })
        } else if (elapsed > staleMs) {
            results.push({
                taskId: task.taskId,
                health: 'stale',
                reason: `no activity for ${Math.round(elapsed / 1000)}s (>${Math.round(staleMs / 1000)}s)`,
                lastActivityAt: lastActivity,
                staleThresholdMs: staleMs,
            })
        } else {
            results.push({
                taskId: task.taskId,
                health: 'healthy',
                reason: 'active',
                lastActivityAt: lastActivity,
                staleThresholdMs: staleMs,
            })
        }
    }

    return results
}

export function markStaleTask(
    taskId: string,
    taskType: string,
    description: string,
    reason: string,
): void {
    logForDebugging(`task-stale taskId=${taskId} reason=${reason}`) // log: inline data into message string
    getNotificationManager().publish({
        taskId,
        taskType,
        event: 'timed_out',
        summary: `Task "${description}" is stale: ${reason}`,
    })
}

export function markLostTask(
    taskId: string,
    taskType: string,
    description: string,
    reason: string,
): void {
    logForDebugging(`task-lost taskId=${taskId} reason=${reason}`) // log: inline data into message string
    getNotificationManager().publish({
        taskId,
        taskType,
        event: 'lost',
        summary: `Task "${description}" is lost: ${reason}`,
    })
}
